import type { ComponentStatus, ComponentVerdictRow } from "../types";

// Append-only provenance trail for verify-pipeline status transitions.
// Modeled after semantica's record_decision()/trace_decision_chain()
// (github.com/semantica-agi/semantica) -- a component's `status` column
// only ever holds the current snapshot, so without this, "why did this end
// up capability:fail" meant cross-referencing scattered evidence/*.json
// files across R2 by hand. One row per tier decision instead, in one place,
// queryable per component.
export async function recordVerdict(
  db: D1Database,
  componentId: string,
  status: ComponentStatus,
  reasoning: string,
  evidenceKey: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO component_verdicts (id, component_id, status, reasoning, evidence_key) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), componentId, status, reasoning, evidenceKey)
    .run();
}

// Oldest-first: reads as the actual sequence of tier decisions that
// produced the component's current status, not a most-recent-first log.
export async function traceDecisionChain(
  db: D1Database,
  componentId: string,
): Promise<ComponentVerdictRow[]> {
  const result = await db
    .prepare("SELECT * FROM component_verdicts WHERE component_id = ? ORDER BY recorded_at ASC, rowid ASC")
    .bind(componentId)
    .all<ComponentVerdictRow>();
  return result.results;
}
