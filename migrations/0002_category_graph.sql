-- Open-ended, hierarchical category graph ("subclades"), additive alongside
-- the existing fixed `category` column on components -- that column is not
-- touched here, it still gates the capability tier (see
-- CAPABILITY_TIER_CATEGORY in src/types.ts). Built from the classify
-- tier's new `suggestedCategory` field: a self-referential node tree
-- instead of a fixed list, so a repo outside the original six categories
-- (e.g. a trading bot) gets a real node instead of being force-fit into
-- "other" or "orchestration". No uniqueness constraint on (name,
-- parent_id): SQLite doesn't treat NULL parent_id as equal to itself in a
-- UNIQUE index, so it can't actually enforce top-level-name uniqueness --
-- dedup is handled in findOrCreateCategoryNode() instead.
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

ALTER TABLE components ADD COLUMN category_node_id TEXT REFERENCES categories(id);
