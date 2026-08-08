// Applies migrations/*.sql statement-by-statement via prepare().run() rather
// than D1Database.exec() (which has stricter single-line-statement,
// no-comment constraints) so local test runs don't depend on that parser.
// Keep this in sync with migrations/0001_init.sql and 0002_category_graph.sql.
const STATEMENTS: string[] = [
  `CREATE TABLE accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    handle     TEXT NOT NULL UNIQUE,
    x_user_id  TEXT NOT NULL UNIQUE,
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
    tier_reached       TEXT NOT NULL DEFAULT 'none',
    status             TEXT NOT NULL DEFAULT 'discovered',
    evidence_prefix    TEXT NOT NULL,
    discovered_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    verified_at        TEXT,
    commit_sha_checked TEXT,
    UNIQUE (repo_owner, repo_name)
  )`,
  `CREATE INDEX idx_components_category_status ON components(category, status)`,
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
];

export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function resetSchema(db: D1Database): Promise<void> {
  await db.prepare("DROP TABLE IF EXISTS source_posts").run();
  await db.prepare("DROP TABLE IF EXISTS components").run();
  await db.prepare("DROP TABLE IF EXISTS categories").run();
  await db.prepare("DROP TABLE IF EXISTS accounts").run();
  await applySchema(db);
}
