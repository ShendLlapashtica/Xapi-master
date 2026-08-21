import {
  copyClassificationFromDuplicate,
  findComponentByReadmeFingerprint,
  findOrCreateCategoryNode,
  getComponent,
  listTopLevelCategories,
  setReadmeFingerprint,
  updateComponentClassification,
} from "../catalog/components-repo";
import { evidenceKey, writeEvidenceBatch, type EvidenceWrite } from "../catalog/evidence-store";
import type { Env } from "../types";
import { classifyReadme } from "./groq-client";
import { getReadmeText } from "./github-client";
import { fingerprintReadme } from "./readme-fingerprint";

// Backfills category_node_id for components that reached classify (real
// evidence-backed catalog rows: category and claims already populated)
// before that field existed -- see
// diligence/2026-08-09-category-node-id-backfill-gap.md for the full case.
// Deliberately narrow: this is *only* the classify step's category-graph
// half, run against an already-terminal component. It does not touch
// tier_reached/status/smoke/capability results, and does not run the
// embedding/similarity-edge step classify normally does (that's a
// separate concern -- connecting to the graph, not having a category at
// all -- left out to keep this backfill's blast radius small and match
// the diligence doc's own proposed heuristic exactly).
//
// Not run inside a Workflow -- this is a one-shot admin action over
// already-verified rows, so step.do()'s durable-retry/resume machinery
// isn't needed the way it is for the first-time verification path; a
// failed row is just re-submitted.

export type BackfillOutcome =
  | { componentId: string; name: string; result: "skipped_has_category_node_id" }
  | { componentId: string; name: string; result: "skipped_never_classified" }
  | { componentId: string; name: string; result: "skipped_no_readme" }
  | { componentId: string; name: string; result: "duplicate"; categoryNodeId: string | null; duplicateOf: string }
  | { componentId: string; name: string; result: "classified"; categoryNodeId: string }
  | { componentId: string; name: string; result: "error"; error: string };

export async function backfillCategoryForComponent(env: Env, componentId: string): Promise<BackfillOutcome> {
  const component = await getComponent(env.DB, componentId);
  if (!component) {
    return { componentId, name: "(unknown)", result: "error", error: "component not found" };
  }
  const name = component.name;

  if (component.category_node_id) {
    return { componentId, name, result: "skipped_has_category_node_id" };
  }
  // Only backfill rows that already went through classify once (category +
  // claims populated) -- a row that never reached classify (still
  // "discovered", or stuck at sanity:fail) isn't this gap; it's either
  // pending normal verification or correctly never got this far. Forcing
  // classify on those is a different, larger change than a backfill.
  if (!component.category || !component.claims) {
    return { componentId, name, result: "skipped_never_classified" };
  }

  try {
    const readmeText = await getReadmeText(component.repo_owner, component.repo_name, {
      token: env.GITHUB_TOKEN,
    });
    if (!readmeText) {
      return { componentId, name, result: "skipped_no_readme" };
    }

    const fingerprint = await fingerprintReadme(readmeText);
    const duplicate = await findComponentByReadmeFingerprint(env.DB, fingerprint, componentId);

    if (duplicate) {
      await writeEvidenceBatch(env.EVIDENCE, [
        { key: evidenceKey(componentId, "backfill-category", "readme.md"), body: readmeText },
      ]);
      await copyClassificationFromDuplicate(env.DB, componentId, duplicate);
      await setReadmeFingerprint(env.DB, componentId, fingerprint, duplicate.id);
      return {
        componentId,
        name,
        result: "duplicate",
        categoryNodeId: duplicate.category_node_id,
        duplicateOf: duplicate.id,
      };
    }

    const existingClades = await listTopLevelCategories(env.DB);
    const classifyResult = await classifyReadmeWithBackoff(readmeText, env.GROQ_API_KEY, existingClades);

    const evidenceEntries: EvidenceWrite[] = [
      { key: evidenceKey(componentId, "backfill-category", "readme.md"), body: readmeText },
      {
        key: evidenceKey(componentId, "backfill-category", "response.json"),
        body: classifyResult.rawResponseText,
        contentType: "application/json",
      },
    ];
    await writeEvidenceBatch(env.EVIDENCE, evidenceEntries);

    const parentId = await findOrCreateCategoryNode(env.DB, classifyResult.classification.suggestedParentClade);
    const categoryNodeId = await findOrCreateCategoryNode(
      env.DB,
      classifyResult.classification.suggestedCategory,
      parentId,
    );
    await updateComponentClassification(
      env.DB,
      componentId,
      {
        ...classifyResult.classification,
        rawResponseEvidenceKey: evidenceKey(componentId, "backfill-category", "response.json"),
      },
      categoryNodeId,
    );
    await setReadmeFingerprint(env.DB, componentId, fingerprint, null);

    return { componentId, name, result: "classified", categoryNodeId };
  } catch (err) {
    return { componentId, name, result: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// Same rate-limit shape verify-workflow.ts's classify-llm step guards
// against (Groq free tier's 8000 tokens/minute budget, shared across
// concurrent calls) -- this backfill calls classifyReadme in a tight loop
// across many rows, so it needs the same generous backoff, just as a plain
// retry loop instead of step.do's built-in one (no Workflow context here).
async function classifyReadmeWithBackoff(
  readmeText: string,
  apiKey: string,
  existingClades: string[],
): ReturnType<typeof classifyReadme> {
  const delays = [15_000, 30_000, 60_000, 120_000, 240_000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await classifyReadme(readmeText, { apiKey }, existingClades);
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  throw lastErr;
}
