-- Tracked X roster. Seeded via POST /admin/accounts/seed; x_user_id is
-- resolved offline (a one-time GET /2/users/by call) rather than live by
-- that route, since resolving 10-20 handles is a one-time setup task, not
-- pipeline logic.
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  handle     TEXT NOT NULL UNIQUE,
  x_user_id  TEXT NOT NULL UNIQUE,
  added_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- The catalog. tier_reached tracks the highest tier *cleared*, not
-- attempted (see src/verify/status.ts). A row is written at `discovered`
-- and updated in place as tiers complete -- a sanity or smoke failure is a
-- terminal status, never a deleted row.
CREATE TABLE components (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  repo_url           TEXT NOT NULL,
  category           TEXT,
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
);
CREATE INDEX idx_components_category_status ON components(category, status);

-- Many source posts can point at the same component (a repo gets reshared).
CREATE TABLE source_posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id   TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  post_id        TEXT NOT NULL,
  post_url       TEXT NOT NULL,
  author_handle  TEXT NOT NULL,
  posted_at      TEXT NOT NULL,
  UNIQUE (component_id, post_id)
);
CREATE INDEX idx_source_posts_component ON source_posts(component_id);
