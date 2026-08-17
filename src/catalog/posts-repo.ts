export const POST_STATUSES = ["pending", "approved", "rejected", "posted", "post_failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface PostRow {
  id: string;
  component_id: string;
  reply_to_tweet_id: string;
  text: string;
  status: PostStatus;
  created_at: string;
  reviewed_at: string | null;
  posted_at: string | null;
  error: string | null;
}

export interface NewPost {
  id: string;
  componentId: string;
  replyToTweetId: string;
  text: string;
}

export interface ListPostsParams {
  status?: PostStatus;
  limit?: number;
  cursor?: string;
}

export interface ListPostsResult {
  rows: PostRow[];
  nextCursor: string | null;
}

export async function insertPendingPost(db: D1Database, post: NewPost): Promise<void> {
  await db
    .prepare(
      `INSERT INTO posts (id, component_id, reply_to_tweet_id, text, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .bind(post.id, post.componentId, post.replyToTweetId, post.text)
    .run();
}

export async function getPost(db: D1Database, id: string): Promise<PostRow | null> {
  const row = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<PostRow>();
  return row ?? null;
}

export async function markPostRejected(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE posts SET status = 'rejected', reviewed_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
}

export async function markPostPosted(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE posts SET status = 'posted', reviewed_at = ?, posted_at = ? WHERE id = ?")
    .bind(now, now, id)
    .run();
}

export async function markPostFailed(db: D1Database, id: string, error: string): Promise<void> {
  await db
    .prepare("UPDATE posts SET status = 'post_failed', reviewed_at = ?, error = ? WHERE id = ?")
    .bind(new Date().toISOString(), error, id)
    .run();
}

// Cooldown check: the approve handler compares this against a fixed window
// (see src/api/posts-route.ts) rather than something more elaborate, since
// the account-suspension risk this guards against only cares about "how
// long since the last real post," not per-post scheduling.
export async function getMostRecentlyPostedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT posted_at FROM posts WHERE status = 'posted' ORDER BY posted_at DESC LIMIT 1")
    .first<{ posted_at: string }>();
  return row?.posted_at ?? null;
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as [string, string];
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// Same limit+1 / opaque-cursor convention as listComponents (components-repo.ts).
export async function listPosts(db: D1Database, params: ListPostsParams): Promise<ListPostsResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.status) {
    conditions.push("status = ?");
    binds.push(params.status);
  }

  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM posts ${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
  binds.push(limit + 1);

  const { results } = await db.prepare(sql).bind(...binds).all<PostRow>();

  const hasMore = results.length > limit;
  const rows = hasMore ? results.slice(0, limit) : results;
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { rows, nextCursor };
}
