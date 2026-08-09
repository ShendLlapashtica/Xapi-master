import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  copyClassificationFromDuplicate,
  findComponentByReadmeFingerprint,
  findOrCreateCategoryNode,
  getComponent,
  listSourcePostsForComponent,
  parseCliInvocation,
  setReadmeFingerprint,
  updateComponentClassification,
  updateComponentSanityPass,
  updateComponentStatus,
} from "../catalog/components-repo";
import { evidenceKey, writeEvidenceBatch } from "../catalog/evidence-store";
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
import { classifyReadme } from "./groq-client";
import { getReadmeText } from "./github-client";
import { computeMajorityVerdict } from "./majority-verdict";
import { fingerprintReadme } from "./readme-fingerprint";
import { isTerminalStatus } from "./status";
import { runCapabilityFixture, FIXTURES } from "./steps/capability";
import { runSanityCheck } from "./steps/sanity";
import { detectStackForRepo, runSmoke } from "./steps/smoke";
import { createXClient, postTweet } from "../listener/x-client";

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

async function postWorkflowResult(step: WorkflowStep, db: D1Database, env: Env, componentId: string): Promise<void> {
  await step.do("post-to-x", async () => {
    const finalComponent = await getComponent(db, componentId);
    if (!finalComponent) return;

    if (!isTerminalStatus(finalComponent.status, finalComponent.category)) {
      return;
    }

    const sourcePosts = await listSourcePostsForComponent(db, componentId);
    const originalPost = sourcePosts.reduce((oldest, current) => {
      return !oldest || new Date(current.posted_at) < new Date(oldest.posted_at) ? current : oldest;
    }, null as SourcePostRow | null);

    if (!originalPost || originalPost.post_url === "manual-trigger" || originalPost.post_id.startsWith("manual-")) {
      console.log(`[X Bot] Skipping X post: component ${componentId} was triggered manually.`);
      return;
    }

    const tweetId = originalPost.post_id;
    const text = formatTweetText(finalComponent);

    if (env.X_SESSION_TOKEN) {
      const client = createXClient(env.X_SESSION_TOKEN);
      try {
        await postTweet(client, text, tweetId);
      } catch (err) {
        // Deliberately swallowed, not rethrown: step.do() retries a step
        // that throws, and X's own response can fail/time out *after* the
        // reply already went through server-side -- rethrowing here risks
        // a second real reply to the same tweet on retry. A silently
        // missed reply is a far better failure mode for a public-facing
        // bot than a duplicate one; this is caught, not corrupted -- the
        // component's verification result is unaffected either way.
        console.error(`[X Bot] Failed to post reply for component ${componentId}, not retrying:`, err);
      }
    } else {
      console.log(`[X Bot] Would post tweet: "${text}" replying to: ${tweetId || "none"}`);
    }
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
      await postWorkflowResult(step, this.env.DB, this.env, componentId);
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
      }
    });

    if (!sanity.passed || !sanity.headSha) {
      return;
    }
    const commitSha = sanity.headSha;

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
        const classifyResult = await step.do(
          "classify-llm",
          // Groq's free tier shares an 8000 tokens/minute budget across every
          // concurrent verification run -- confirmed live, two repos
          // classifying at once were enough to trip it. A longer, more
          // generous backoff (up to ~4 minutes total) matters more here than
          // it would against a paid-tier or per-request-limited API.
          { retries: { limit: 5, delay: "15 seconds", backoff: "exponential" } },
          async () => classifyReadme(readmeText, { apiKey: this.env.GROQ_API_KEY }),
        );

        await step.do("classify-persist", async () => {
          await writeEvidenceBatch(this.env.EVIDENCE, [
            { key: evidenceKey(componentId, "classify", "readme.md"), body: readmeText },
            {
              key: evidenceKey(componentId, "classify", "response.json"),
              body: classifyResult.rawResponseText,
              contentType: "application/json",
            },
          ]);
          // Top-level for now (parentId null) -- nesting into subclades is a
          // curation step that doesn't exist yet, see types.ts's "Category
          // graph" comment.
          const categoryNodeId = await findOrCreateCategoryNode(
            this.env.DB,
            classifyResult.classification.suggestedCategory,
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
    });
  }
}
