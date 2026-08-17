-- Draft-then-approve queue for X replies. Nothing in this pipeline calls
-- postTweet() directly anymore (see src/verify/verify-workflow.ts's
-- postWorkflowResult) -- a terminal verification result creates a `pending`
-- row here instead, and the only place postTweet() is ever actually called
-- is the admin approve handler (src/api/posts-route.ts), gated on
-- X_POSTING_ENABLED and a cooldown against the most recently posted row.
--
-- 'approved' is unused today -- approve posts synchronously (pending ->
-- posted/post_failed in one call) -- but kept in the status vocabulary
-- (enforced in TS, not a SQL CHECK, matching this schema's existing
-- convention) so a future async approve-then-post split doesn't need a
-- migration to add it.
CREATE TABLE posts (
  id                TEXT PRIMARY KEY,
  component_id      TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  reply_to_tweet_id TEXT NOT NULL,
  text              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | posted | post_failed
  created_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reviewed_at       TEXT,
  posted_at         TEXT,
  error             TEXT
);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_component ON posts(component_id);
