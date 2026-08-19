-- Decision provenance for the verify pipeline, modeled after semantica's
-- record_decision()/trace_decision_chain() (github.com/semantica-agi/semantica)
-- reimplemented natively in D1/SQLite rather than pulled in as a Python
-- dependency (Xapi is a Cloudflare Worker, semantica is a Python package --
-- no runtime path to use it directly). components.status only ever holds
-- the current snapshot; this is the append-only trail of *why* it got
-- there, one row per tier decision, queryable per component instead of
-- only visible as scattered evidence/*.json files across R2.
CREATE TABLE component_verdicts (
  id           TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  reasoning    TEXT NOT NULL,
  evidence_key TEXT,
  recorded_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_component_verdicts_component ON component_verdicts(component_id);
