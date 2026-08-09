-- Real, persisted relationships between components -- what the Vectorize
-- similarity check (src/verify/embeddings.ts) was missing: it ran a live
-- query at classify time and wrote a one-off flag to R2 evidence, but
-- never saved the relationship anywhere queryable afterward. That's a
-- lookup, not a graph. This table is the actual edge store: every
-- similarity match above threshold becomes a real row, so "what's
-- connected to this component" is a SQL query, not a re-run of the
-- embedding search.
CREATE TABLE component_edges (
  id                TEXT PRIMARY KEY,
  from_component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  to_component_id   TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'similar_to',
  score             REAL NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (from_component_id, to_component_id, relationship_type)
);
CREATE INDEX idx_component_edges_from ON component_edges(from_component_id);
CREATE INDEX idx_component_edges_to ON component_edges(to_component_id);
