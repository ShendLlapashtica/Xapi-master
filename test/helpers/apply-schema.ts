// Applies migrations/*.sql statement-by-statement via prepare().run() rather
// than D1Database.exec() (which has stricter single-line-statement,
// no-comment constraints) so local test runs don't depend on that parser.
// Keep this in sync with migrations/0001_init.sql through 0008_posts.sql.
// (0006/0007/0008 were missing entirely until 2026-08-17 -- backfilled
// together rather than one migration at a time, to avoid three separate
// partial edits to this file colliding.)
const STATEMENTS: string[] = [
  `CREATE TABLE accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    handle     TEXT NOT NULL UNIQUE,
    x_user_id  TEXT UNIQUE,
    added_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX idx_categories_parent ON categories(parent_id)`,
  `CREATE TABLE components (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    repo_owner         TEXT NOT NULL,
    repo_name          TEXT NOT NULL,
    repo_url           TEXT NOT NULL,
    category           TEXT,
    category_node_id   TEXT REFERENCES categories(id),
    claims             TEXT,
    mechanism_summary  TEXT,
    cli_invocation     TEXT,
    readme_fingerprint TEXT,
    duplicate_of_component_id TEXT REFERENCES components(id),
    tier_reached       TEXT NOT NULL DEFAULT 'none',
    status             TEXT NOT NULL DEFAULT 'discovered',
    evidence_prefix    TEXT NOT NULL,
    discovered_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    verified_at        TEXT,
    commit_sha_checked TEXT,
    UNIQUE (repo_owner, repo_name)
  )`,
  `CREATE INDEX idx_components_category_status ON components(category, status)`,
  `CREATE INDEX idx_components_readme_fingerprint ON components(readme_fingerprint)`,
  `CREATE TABLE source_posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    component_id   TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    post_id        TEXT NOT NULL,
    post_url       TEXT NOT NULL,
    author_handle  TEXT NOT NULL,
    posted_at      TEXT NOT NULL,
    UNIQUE (component_id, post_id)
  )`,
  `CREATE INDEX idx_source_posts_component ON source_posts(component_id)`,
  `CREATE TABLE component_edges (
    id                TEXT PRIMARY KEY,
    from_component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    to_component_id   TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'similar_to',
    score             REAL NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE (from_component_id, to_component_id, relationship_type)
  )`,
  `CREATE INDEX idx_component_edges_from ON component_edges(from_component_id)`,
  `CREATE INDEX idx_component_edges_to ON component_edges(to_component_id)`,

  // 0006_domain_nodes.sql
  `CREATE TABLE domains (
    id              TEXT PRIMARY KEY,
    hostname        TEXT NOT NULL UNIQUE,
    audit_status    TEXT NOT NULL DEFAULT 'discovered',
    last_audited_at TEXT,
    discovered_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX idx_domains_status ON domains(audit_status)`,
  `CREATE TABLE domain_audit_results (
    id               TEXT PRIMARY KEY,
    domain_id        TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    audited_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    score_total      INTEGER NOT NULL DEFAULT 0,
    score_dns        INTEGER,
    score_email      INTEGER,
    score_tls        INTEGER,
    score_headers    INTEGER,
    score_reputation INTEGER,
    score_infra      INTEGER,
    score_app        INTEGER,
    attributes       TEXT NOT NULL
  )`,
  `CREATE INDEX idx_domain_audit_results_domain ON domain_audit_results(domain_id)`,
  `CREATE TABLE domain_component_edges (
    id           TEXT PRIMARY KEY,
    domain_id    TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL DEFAULT 'operator',
    created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE (domain_id, component_id, relationship)
  )`,
  `CREATE TABLE domain_sibling_edges (
    id           TEXT PRIMARY KEY,
    domain_a_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    domain_b_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL DEFAULT 'sibling_operator',
    created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE (domain_a_id, domain_b_id)
  )`,

  // 0007_domain_watch_and_diffs.sql
  `ALTER TABLE domains ADD COLUMN watched INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE domains ADD COLUMN watched_at TEXT`,
  `CREATE INDEX idx_domains_watched ON domains(watched)`,
  `CREATE TABLE domain_audit_diffs (
    id             TEXT PRIMARY KEY,
    domain_id      TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    prev_result_id TEXT NOT NULL REFERENCES domain_audit_results(id) ON DELETE CASCADE,
    curr_result_id TEXT NOT NULL REFERENCES domain_audit_results(id) ON DELETE CASCADE,
    changed_keys   TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX idx_domain_audit_diffs_domain ON domain_audit_diffs(domain_id)`,

  // 0008_posts.sql
  `CREATE TABLE posts (
    id                TEXT PRIMARY KEY,
    component_id      TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    reply_to_tweet_id TEXT NOT NULL,
    text              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    reviewed_at       TEXT,
    posted_at         TEXT,
    error             TEXT
  )`,
  `CREATE INDEX idx_posts_status ON posts(status)`,
  `CREATE INDEX idx_posts_component ON posts(component_id)`,
];

export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function resetSchema(db: D1Database): Promise<void> {
  await db.prepare("DROP TABLE IF EXISTS posts").run();
  await db.prepare("DROP TABLE IF EXISTS domain_audit_diffs").run();
  await db.prepare("DROP TABLE IF EXISTS domain_sibling_edges").run();
  await db.prepare("DROP TABLE IF EXISTS domain_component_edges").run();
  await db.prepare("DROP TABLE IF EXISTS domain_audit_results").run();
  await db.prepare("DROP TABLE IF EXISTS domains").run();
  await db.prepare("DROP TABLE IF EXISTS component_edges").run();
  await db.prepare("DROP TABLE IF EXISTS source_posts").run();
  await db.prepare("DROP TABLE IF EXISTS components").run();
  await db.prepare("DROP TABLE IF EXISTS categories").run();
  await db.prepare("DROP TABLE IF EXISTS accounts").run();
  await applySchema(db);
}
