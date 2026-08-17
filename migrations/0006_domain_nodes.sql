-- Domain / website nodes -- a second node type alongside `components` (repos).
-- Discovered via POST /admin/audit-domain; audited by DomainAuditWorkflow.
CREATE TABLE domains (
  id              TEXT PRIMARY KEY,     -- UUIDv4
  hostname        TEXT NOT NULL UNIQUE, -- e.g. "autokoreablendi.com" (no scheme, no trailing slash)
  audit_status    TEXT NOT NULL DEFAULT 'discovered', -- discovered | auditing | done | error
  last_audited_at TEXT,
  discovered_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_domains_status ON domains(audit_status);

-- One row per audit run (re-auditing a domain appends a new row).
-- `attributes` is the full 100-attribute JSON blob.
-- Per-family scores are denormalized here for cheap listing queries.
CREATE TABLE domain_audit_results (
  id               TEXT PRIMARY KEY,
  domain_id        TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  audited_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  score_total      INTEGER NOT NULL DEFAULT 0, -- count of passing attributes (0-100)
  score_dns        INTEGER,   -- passing out of 15
  score_email      INTEGER,   -- passing out of 20
  score_tls        INTEGER,   -- passing out of 20
  score_headers    INTEGER,   -- passing out of 15
  score_reputation INTEGER,   -- passing out of 10
  score_infra      INTEGER,   -- passing out of 10
  score_app        INTEGER,   -- passing out of 10
  attributes       TEXT NOT NULL  -- JSON: all 100 attribute key/value pairs
);
CREATE INDEX idx_domain_audit_results_domain ON domain_audit_results(domain_id);

-- Graph edges: link domains ↔ components when the same operator owns both.
-- Also used for domain ↔ domain sibling edges (same operator, different hostnames).
CREATE TABLE domain_component_edges (
  id           TEXT PRIMARY KEY,
  domain_id    TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'operator', -- operator | deploys | serves
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (domain_id, component_id, relationship)
);

CREATE TABLE domain_sibling_edges (
  id           TEXT PRIMARY KEY,
  domain_a_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  domain_b_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'sibling_operator',
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (domain_a_id, domain_b_id)
);
