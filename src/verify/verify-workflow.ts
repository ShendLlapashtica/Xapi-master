import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  copyClassificationFromDuplicate,
  createEdge,
  findComponentByReadmeFingerprint,
  findOrCreateCategoryNode,
  getComponent,
  listSourcePostsForComponent,
  listTopLevelCategories,
  parseCliInvocation,
  setReadmeFingerprint,
  updateComponentClassification,
  updateComponentSanityPass,
  updateComponentStatus,
} from "../catalog/components-repo";
import { recordVerdict } from "../catalog/decision-log";
import { evidenceKey, writeEvidenceBatch, type EvidenceWrite } from "../catalog/evidence-store";
import {
  CAPABILITY_TIER_CATEGORY,
  type Category,
  type CliInvocation,
  type Env,
  type FixtureResult,
  type VerifyRequestParams,
  type SourcePostRow,
  type ComponentRow,
} from "../types";
import { embedText, filterRelevantMatches } from "./embeddings";
import { classifyReadme } from "./groq-client";
import { getReadmeText } from "./github-client";
import { computeMajorityVerdict } from "./majority-verdict";
import { fingerprintReadme } from "./readme-fingerprint";
import { isTerminalStatus, smokeReasoning } from "./status";
import { runCapabilityFixture, FIXTURES } from "./steps/capability";
import { runDangerScan } from "./steps/danger-scan";
import { runSecretsScan } from "./steps/secrets-scan";
import { runSanityCheck } from "./steps/sanity";
import { detectUnverifiableClaim } from "./steps/unverifiable-claim";
import { detectStackForRepo, runSmoke } from "./steps/smoke";
import { insertPendingPost } from "../catalog/posts-repo";

// Deliberately no emoji, no ALL-CAPS -- this is a public reply attached to
// a stranger's post, and reads as a bot regardless, but a measured,
// consistent voice is the difference between "useful automated check" and
// "spam account." The results link is cheap (X shortens any URL to a flat
// ~23 chars via t.co) and turns a bare verdict into something a reader can
// actually verify themselves rather than take on faith.
const RESULTS_URL = "xapi.prishtina-online.workers.dev";

function formatTweetText(component: ComponentRow): string {
  const repoStr = `${component.repo_owner}/${component.repo_name}`;
  const category = component.category || "uncategorized";
  let msg = "";

  switch (component.status) {
    case "sanity:fail":
      msg = `Xapi check — ${repoStr} didn't pass basic validation (missing license/README, or empty repo). ${RESULTS_URL}`;
      break;
    case "smoke:fail":
      msg = `Xapi check — ${repoStr} failed to build in an isolated sandbox. ${RESULTS_URL}`;
      break;
    case "smoke:unsupported_stack":
      msg = `Xapi check — ${repoStr} uses a stack we don't verify yet (Node/Python only, for now).`;
      break;
    case "smoke:pass":
      msg = `Xapi check — ${repoStr} builds cleanly (${category}). ${RESULTS_URL}`;
      break;
    case "capability:pass":
      msg = `Xapi check — ${repoStr} passed real-document testing for ${category}. ${RESULTS_URL}`;
      break;
    case "capability:partial":
      msg = `Xapi check — ${repoStr} passed some but not all real-document tests (${category}). ${RESULTS_URL}`;
      break;
    case "capability:fail":
      msg = `Xapi check — ${repoStr} did not pass real-document testing (${category}). ${RESULTS_URL}`;
      break;
    case "capability:undetermined":
      msg = `Xapi check — ${repoStr} couldn't be reliably invoked for testing. Inconclusive.`;
      break;
    default:
      msg = `Xapi check — ${repoStr}: status updated to ${component.status}.`;
  }

  if (msg.length > 280) {
    msg = msg.slice(0, 277) + "...";
  }
  return msg;
}

// Shared by draftStartedPost and draftWorkflowResult: a component discovered
// manually (POST /admin/verify-repo, not a live X post) has nothing to reply
// to, and never did -- this is the same guard the old direct-posting code
// had, just factored out so both draft points apply it identically.
async function resolveReplyTweetId(db: D1Database, componentId: string): Promise<string | null> {
  const sourcePosts = await listSourcePostsForComponent(db, componentId);
  const originalPost = sourcePosts.reduce((oldest, current) => {
    return !oldest || new Date(current.posted_at) < new Date(oldest.posted_at) ? current : oldest;
  }, null as SourcePostRow | null);

  if (!originalPost || originalPost.post_url === "manual-trigger" || originalPost.post_id.startsWith("manual-")) {
    return null;
  }
  return originalPost.post_id;
}

// Drafts a "started checking" reply as soon as there's a real repo worth
// saying that about (sanity passed) -- makes an in-progress run visible
// instead of silent until the terminal result, without needing a live
// status endpoint. Same draft-then-approve queue as the result post below;
// nothing here calls X.
export async function draftStartedPost(step: WorkflowStep, db: D1Database, componentId: string, repoOwner: string, repoName: string): Promise<void> {
  await step.do("draft-started-post", async () => {
    const tweetId = await resolveReplyTweetId(db, componentId);
    if (!tweetId) return;

    const text = `Xapi check — now verifying ${repoOwner}/${repoName}. ${RESULTS_URL}`;
    await insertPendingPost(db, { id: crypto.randomUUID(), componentId, replyToTweetId: tweetId, text });
  });
}

// Drafts the terminal-result reply instead of posting it directly -- nothing
// in this file calls X anymore. The only place postTweet() is ever actually
// called is the admin approve handler (src/api/posts-route.ts), gated on
// X_POSTING_ENABLED and a cooldown, after a human reviews the draft this
// creates. Every guard below (terminal-status check, manual-trigger skip)
// is unchanged from the direct-posting code this replaced -- only the final
// action changed, from "call postTweet" to "insert a pending row."
export async function draftWorkflowResult(step: WorkflowStep, db: D1Database, componentId: string): Promise<void> {
  await step.do("draft-result-post", async () => {
    const finalComponent = await getComponent(db, componentId);
    if (!finalComponent) return;

    if (!isTerminalStatus(finalComponent.status, finalComponent.category)) {
      return;
    }

    const tweetId = await resolveReplyTweetId(db, componentId);
    if (!tweetId) {
      console.log(`[X Bot] Skipping draft: component ${componentId} was triggered manually.`);
      return;
    }

    const text = formatTweetText(finalComponent);
    await insertPendingPost(db, { id: crypto.randomUUID(), componentId, replyToTweetId: tweetId, text });
  });
}

// One Workflow instance per newly-discovered repo (see src/extract/extract-consumer.ts,
// which creates instances with a deterministic `verify-${componentId}` id --
// a second, independent dedupe layer on top of the D1 check-then-insert).
//
// A tier *failing* is a normal, successful workflow completion carrying a
// negative verdict -- never a thrown error. Errors/NonRetryableError are
// reserved for genuine infra failures, so the Workflows dashboard's error
// bucket stays meaningful instead of being swamped by expected
// sanity:fail/smoke:fail rows. See BRIEF.md §2 "Verify".
export class VerificationWorkflow extends WorkflowEntrypoint<Env, VerifyRequestParams> {
  async run(event: WorkflowEvent<VerifyRequestParams>, step: WorkflowStep): Promise<void> {
    const { componentId } = event.payload;
    try {
      await this.runVerification(event, step);
    } finally {
      await draftWorkflowResult(step, this.env.DB, componentId);
    }
  }

  async runVerification(event: WorkflowEvent<VerifyRequestParams>, step: WorkflowStep): Promise<void> {
    const { componentId, repoOwner, repoName } = event.payload;

    const component = await step.do("load-component", async () => {
      const row = await getComponent(this.env.DB, componentId);
      if (!row) {
        // The row Extract inserted before enqueuing this workflow is gone --
        // a genuine infra/data inconsistency, not a verification outcome.
        throw new NonRetryableError(`component ${componentId} not found`);
      }
      return row;
    });

    // ---- Sanity ----
    const sanity = await step.do("sanity-check", async () => runSanityCheck(repoOwner, repoName, this.env));

    await step.do("sanity-persist", async () => {
      await writeEvidenceBatch(this.env.EVIDENCE, [
        {
          key: evidenceKey(componentId, "sanity", "result.json"),
          body: JSON.stringify(sanity, null, 2),
          contentType: "application/json",
        },
      ]);
      if (sanity.passed && sanity.headSha) {
        await updateComponentSanityPass(this.env.DB, componentId, sanity.headSha);
      } else {
        await updateComponentStatus(this.env.DB, componentId, "sanity:fail", true);
        await recordVerdict(
          this.env.DB,
          componentId,
          "sanity:fail",
          sanity.reason ?? "sanity check failed",
          evidenceKey(componentId, "sanity", "result.json"),
        );
      }
    });

    if (!sanity.passed || !sanity.headSha) {
      return;
    }
    const commitSha = sanity.headSha;

    await draftStartedPost(step, this.env.DB, componentId, repoOwner, repoName);

    // ---- Danger scan ----
    // Static content scan for supply-chain/malware shapes -- no code
    // execution, same class of checks as the repo-vetting skill's hard
    // gates (pipe-to-shell, eval, credential-exfil-into-network-call,
    // suspicious npm install hooks). Runs here, before classify, so a
    // flagged repo never costs a Groq call or reaches a sandbox. Reuses
    // the existing sanity:fail status rather than adding a new one --
    // deliberately not touching src/types.ts's ComponentStatus union
    // while another session has substantial uncommitted work in that
    // file (domain-node types, see git status 2026-08-16); this can move
    // to its own status value once that lands and the merge is clean.
    const dangerScan = await step.do("danger-scan", async () => runDangerScan(repoOwner, repoName, commitSha, this.env));
    await step.do("danger-scan-persist", async () => {
      await writeEvidenceBatch(this.env.EVIDENCE, [
        {
          key: evidenceKey(componentId, "danger-scan", "result.json"),
          body: JSON.stringify(dangerScan, null, 2),
          contentType: "application/json",
        },
      ]);
      if (!dangerScan.passed) {
        await updateComponentStatus(this.env.DB, componentId, "sanity:fail", true);
        await recordVerdict(
          this.env.DB,
          componentId,
          "sanity:fail",
          `danger scan flagged: ${dangerScan.findings.map((f) => f.pattern).join(", ")}`,
          evidenceKey(componentId, "danger-scan", "result.json"),
        );
      }
    });

    if (!dangerScan.passed) {
      return;
    }

    // ---- Secrets scan ----
    // Distinct concern from danger-scan above: that catches code shaped
    // like it exfiltrates a credential; this catches literal secret
    // material committed into the tree, whether or not anything in the
    // repo ever reads it. Same fail-fast-before-classify placement, same
    // reused sanity:fail status, same reason (see danger-scan's comment
    // above about not touching the ComponentStatus union mid-merge).
    const secretsScan = await step.do("secrets-scan", async () => runSecretsScan(repoOwner, repoName, commitSha, this.env));
    await step.do("secrets-scan-persist", async () => {
      await writeEvidenceBatch(this.env.EVIDENCE, [
        {
          key: evidenceKey(componentId, "secrets-scan", "result.json"),
          body: JSON.stringify(secretsScan, null, 2),
          contentType: "application/json",
        },
      ]);
      if (!secretsScan.passed) {
        await updateComponentStatus(this.env.DB, componentId, "sanity:fail", true);
        await recordVerdict(
          this.env.DB,
          componentId,
          "sanity:fail",
          `secrets scan flagged: ${secretsScan.findings.map((f) => f.pattern).join(", ")}`,
          evidenceKey(componentId, "secrets-scan", "result.json"),
        );
      }
    });

    if (!secretsScan.passed) {
      return;
    }

    // ---- Classify ("Understand") ----
    const readmeText = await step.do("classify-fetch-readme", async () =>
      getReadmeText(repoOwner, repoName, { token: this.env.GITHUB_TOKEN }),
    );

    let category = component.category;
    let cliInvocation: CliInvocation | null = parseCliInvocation(component.cli_invocation);
    if (readmeText) {
      const fingerprint = await step.do("classify-fingerprint", async () => fingerprintReadme(readmeText));
      // Exact-match README template already classified elsewhere -- reuse
      // its result instead of spending a fresh, rate-limited Groq call on
      // what is (after stripping images/links/numbers) the same document.
      // See src/verify/readme-fingerprint.ts.
      const duplicate = await step.do("classify-check-duplicate", async () =>
        findComponentByReadmeFingerprint(this.env.DB, fingerprint, componentId),
      );

      if (duplicate) {
        await step.do("classify-persist-duplicate", async () => {
          await writeEvidenceBatch(this.env.EVIDENCE, [
            { key: evidenceKey(componentId, "classify", "readme.md"), body: readmeText },
          ]);
          await copyClassificationFromDuplicate(this.env.DB, componentId, duplicate);
          await setReadmeFingerprint(this.env.DB, componentId, fingerprint, duplicate.id);
        });
        category = duplicate.category as Category | null;
        cliInvocation = parseCliInvocation(duplicate.cli_invocation);
      } else {
        // Fetched fresh each run rather than cached -- the clade list
        // changes as the catalog grows, and a stale list would just bias
        // the model toward clades that existed at some earlier point.
        const existingClades = await step.do("classify-list-clades", async () =>
          listTopLevelCategories(this.env.DB),
        );

        const classifyResult = await step.do(
          "classify-llm",
          // Groq's free tier shares an 8000 tokens/minute budget across every
          // concurrent verification run -- confirmed live, two repos
          // classifying at once were enough to trip it. A longer, more
          // generous backoff (up to ~4 minutes total) matters more here than
          // it would against a paid-tier or per-request-limited API.
          { retries: { limit: 5, delay: "15 seconds", backoff: "exponential" } },
          async () => classifyReadme(readmeText, { apiKey: this.env.GROQ_API_KEY }, existingClades),
        );

        // Flags evidence only, never blocks or changes status -- a repo
        // whose whole claim is "works against a named live third-party
        // site" can't have that claim verified here (would mean testing
        // someone else's production system without authorization), so
        // this records the honest caveat instead of letting a later
        // smoke:pass imply something it never checked.
        const unverifiableClaim = detectUnverifiableClaim(
          classifyResult.classification.claims,
          classifyResult.classification.mechanismSummary,
        );

        await step.do("classify-persist", async () => {
          const evidenceEntries: EvidenceWrite[] = [
            { key: evidenceKey(componentId, "classify", "readme.md"), body: readmeText },
            {
              key: evidenceKey(componentId, "classify", "response.json"),
              body: classifyResult.rawResponseText,
              contentType: "application/json",
            },
          ];
          if (unverifiableClaim.unverifiable) {
            evidenceEntries.push({
              key: evidenceKey(componentId, "classify", "unverifiable-claim.json"),
              body: JSON.stringify(unverifiableClaim, null, 2),
              contentType: "application/json",
            });
          }
          await writeEvidenceBatch(this.env.EVIDENCE, evidenceEntries);
          // Two-level: resolve/create the parent clade first (top-level,
          // parentId null), then the specific leaf under it -- the actual
          // subclade nesting. findOrCreateCategoryNode's check-then-insert
          // dedupes both levels the same way.
          const parentId = await findOrCreateCategoryNode(
            this.env.DB,
            classifyResult.classification.suggestedParentClade,
          );
          const categoryNodeId = await findOrCreateCategoryNode(
            this.env.DB,
            classifyResult.classification.suggestedCategory,
            parentId,
          );
          await updateComponentClassification(
            this.env.DB,
            componentId,
            {
              ...classifyResult.classification,
              rawResponseEvidenceKey: evidenceKey(componentId, "classify", "response.json"),
            },
            categoryNodeId,
          );
          await setReadmeFingerprint(this.env.DB, componentId, fingerprint, null);
        });

        category = classifyResult.classification.category;
        cliInvocation = classifyResult.classification.cliInvocation;

        // Fuzzy pattern matching alongside the exact-fingerprint dedup above
        // -- catches the same scam/hype *shape* described in different
        // words, which an exact hash can't. Flags via evidence only, never
        // changes category/status automatically: a similarity score is
        // something a human (or a future, more confident rule) should
        // weigh, not proof on its own. See src/verify/embeddings.ts.
        const embedding = await step.do("classify-embed", async () =>
          embedText(this.env.AI, readmeText),
        );
        await step.do("classify-embed-upsert", async () => {
          await this.env.README_EMBEDDINGS.upsert([
            {
              id: componentId,
              values: embedding,
              metadata: {
                repo: `${repoOwner}/${repoName}`,
                category: classifyResult.classification.suggestedCategory,
              },
            },
          ]);
        });
        await step.do("classify-similarity-check", async () => {
          const result = await this.env.README_EMBEDDINGS.query(embedding, {
            topK: 5,
            returnMetadata: true,
          });
          const relevant = filterRelevantMatches(result.matches, componentId);
          if (relevant.length > 0) {
            await writeEvidenceBatch(this.env.EVIDENCE, [
              {
                key: evidenceKey(componentId, "classify", "similarity.json"),
                body: JSON.stringify(relevant, null, 2),
                contentType: "application/json",
              },
            ]);
            // The actual graph edge -- persisted, not just logged. This is
            // what makes "what's connected to this component" a real query
            // (getEdgesForComponent) instead of something only true at the
            // moment this check ran.
            for (const match of relevant) {
              await createEdge(this.env.DB, componentId, match.componentId, match.score);
            }
          }
        });
      }
    }

    // ---- Smoke ----
    const detection = await step.do("smoke-detect-stack", async () =>
      detectStackForRepo(repoOwner, repoName, commitSha, this.env),
    );
    const { stack, packageDir } = detection;

    // go/rust are detected correctly (Cargo.toml/go.mod found) but have no
    // buildable E2B template yet -- custom template builds need `e2b
    // template build`, gated on local Docker, still not done (see
    // relay/src/e2b-run.ts). Confirmed live: without this check, a real
    // Rust repo (BurntSushi/ripgrep) reached smoke-run and got an opaque
    // relay 502 (E2B "template not found"), which reads exactly like a
    // build failure of the repo's own code -- a false negative, not a
    // true one. Routing both cases through the same unsupported_stack
    // status keeps that distinction honest until the templates exist.
    if (stack === "unsupported" || stack === "go" || stack === "rust") {
      await step.do("smoke-persist-unsupported", async () => {
        await updateComponentStatus(this.env.DB, componentId, "smoke:unsupported_stack", true);
        await recordVerdict(this.env.DB, componentId, "smoke:unsupported_stack", `detected stack: ${stack}`);
      });
      return;
    }

    const smoke = await step.do("smoke-run", async () => {
      const result = await runSmoke({ owner: repoOwner, repo: repoName, commitSha, stack, packageDir }, this.env);
      await writeEvidenceBatch(this.env.EVIDENCE, [
        {
          key: evidenceKey(componentId, "smoke", "stdout.log"),
          body: result.stdout,
        },
        {
          key: evidenceKey(componentId, "smoke", "stderr.log"),
          body: result.stderr,
        },
        {
          key: evidenceKey(componentId, "smoke", "result.json"),
          body: JSON.stringify(
            { passed: result.passed, exitCode: result.exitCode, sandboxId: result.sandboxId, timedOut: result.timedOut },
            null,
            2,
          ),
          contentType: "application/json",
        },
      ]);
      return { passed: result.passed, exitCode: result.exitCode, sandboxId: result.sandboxId };
    });

    const smokeStatus = smoke.passed ? "smoke:pass" : "smoke:fail";
    const smokeTerminal = isTerminalStatus(smokeStatus, category);
    await step.do("smoke-persist", async () => {
      await updateComponentStatus(this.env.DB, componentId, smokeStatus, smokeTerminal);
      await recordVerdict(
        this.env.DB,
        componentId,
        smokeStatus,
        smokeReasoning(smoke.passed, smoke.exitCode, smokeTerminal),
        evidenceKey(componentId, "smoke", "result.json"),
      );
    });

    if (!smoke.passed || category !== CAPABILITY_TIER_CATEGORY) {
      return;
    }

    // ---- Capability (only for CAPABILITY_TIER_CATEGORY, per PoC scope) ----
    if (!cliInvocation) {
      // Classified as the capability category but no usable CLI invocation
      // was extracted -- can't run fixtures at all. This is exactly the
      // "invocation_error on everything" case, materialized without ever
      // touching a sandbox.
      await step.do("capability-persist-no-invocation", async () => {
        await updateComponentStatus(this.env.DB, componentId, "capability:undetermined", true);
        await recordVerdict(
          this.env.DB,
          componentId,
          "capability:undetermined",
          "classified into the capability tier but no usable CLI invocation was extracted",
        );
      });
      return;
    }
    // Re-bind as `const` so the null-check above stays narrowed inside the
    // closures below -- TS doesn't retain narrowing on a `let` once it's
    // captured by a nested function.
    const resolvedCliInvocation = cliInvocation;

    const fixtureResults: FixtureResult[] = [];
    for (const fixture of FIXTURES) {
      const result = await step.do(`capability-fixture-${fixture.fixtureId}`, async () => {
        const run = await runCapabilityFixture(
          fixture,
          { owner: repoOwner, repo: repoName, commitSha, stack, packageDir, cliInvocation: resolvedCliInvocation },
          this.env,
        );
        const key = evidenceKey(componentId, "capability", fixture.fixtureId, "result.json");
        await writeEvidenceBatch(this.env.EVIDENCE, [
          { key: evidenceKey(componentId, "capability", fixture.fixtureId, "stdout.log"), body: run.stdout },
          { key: evidenceKey(componentId, "capability", fixture.fixtureId, "stderr.log"), body: run.stderr },
          {
            key,
            body: JSON.stringify(
              {
                fixtureId: run.fixtureId,
                outcome: run.outcome,
                exitCode: run.exitCode,
                command: run.command,
                wordCount: run.wordCount,
                detectedStructures: run.detectedStructures,
                durationMs: run.durationMs,
                commitShaChecked: commitSha,
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
            contentType: "application/json",
          },
        ]);
        const { stdout: _stdout, stderr: _stderr, ...publicResult } = run;
        return { ...publicResult, evidenceKey: key };
      });
      fixtureResults.push(result);
    }

    const verdict = computeMajorityVerdict(fixtureResults);
    await step.do("capability-verdict-persist", async () => {
      await updateComponentStatus(this.env.DB, componentId, verdict, true);
      const usableCount = fixtureResults.filter((r) => r.outcome === "usable").length;
      await recordVerdict(
        this.env.DB,
        componentId,
        verdict,
        `${usableCount}/${fixtureResults.length} fixtures usable`,
      );
    });
  }
}
