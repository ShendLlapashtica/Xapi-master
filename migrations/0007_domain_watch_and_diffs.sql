-- Turns the one-shot domain audit into a self-monitoring one: `watched`
-- marks a domain as belonging to the recurring DomainAuditAgent's work
-- list (see src/audit/domain-audit-agent.ts), distinct from every ad-hoc
-- domain discovered via a one-off /admin/audit-domain call. 1:1 per domain,
-- same shape as the existing audit_status/last_audited_at pair -- no join
-- table, no per-row watch metadata needed yet.
ALTER TABLE domains ADD COLUMN watched INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains ADD COLUMN watched_at TEXT;
CREATE INDEX idx_domains_watched ON domains(watched);

-- One row per audit run that actually changed something, computed inside
-- DomainAuditWorkflow itself (see the compute-diff step) by comparing the
-- new domain_audit_results row against the previous latest one for the
-- same domain. Empty diffs are never written -- this table is "what
-- changed", not a redundant copy of every result.
CREATE TABLE domain_audit_diffs (
  id             TEXT PRIMARY KEY,
  domain_id      TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  prev_result_id TEXT NOT NULL REFERENCES domain_audit_results(id) ON DELETE CASCADE,
  curr_result_id TEXT NOT NULL REFERENCES domain_audit_results(id) ON DELETE CASCADE,
  changed_keys   TEXT NOT NULL, -- JSON: { [attributeKey]: { from, to } }
  created_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_domain_audit_diffs_domain ON domain_audit_diffs(domain_id);
