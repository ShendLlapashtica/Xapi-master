import type {
  AccountRow,
  Category,
  CategoryRow,
  Classification,
  ComponentRow,
  ComponentStatus,
  ComponentsQueryParams,
  SourcePostRow,
} from "../types";
import { tierForStatus } from "../verify/status";

export interface NewComponent {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  evidencePrefix: string;
}

export interface NewSourcePost {
  postId: string;
  postUrl: string;
  authorHandle: string;
  postedAt: string;
}

export async function findComponentByRepo(
  db: D1Database,
  repoOwner: string,
  repoName: string,
): Promise<ComponentRow | null> {
  const row = await db
    .prepare("SELECT * FROM components WHERE repo_owner = ? AND repo_name = ?")
    .bind(repoOwner, repoName)
    .first<ComponentRow>();
  return row ?? null;
}

export async function getComponent(db: D1Database, id: string): Promise<ComponentRow | null> {
  const row = await db.prepare("SELECT * FROM components WHERE id = ?").bind(id).first<ComponentRow>();
  return row ?? null;
}

export async function insertDiscoveredComponent(db: D1Database, c: NewComponent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO components (id, name, repo_owner, repo_name, repo_url, tier_reached, status, evidence_prefix)
       VALUES (?, ?, ?, ?, ?, 'none', 'discovered', ?)`,
    )
    .bind(c.id, c.name, c.repoOwner, c.repoName, c.repoUrl, c.evidencePrefix)
    .run();
}

// Idempotent on (component_id, post_id) -- a repo reshared by the same post
// twice (e.g. a retried queue message) doesn't create duplicate rows.
export async function insertSourcePost(
  db: D1Database,
  componentId: string,
  post: NewSourcePost,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO source_posts (component_id, post_id, post_url, author_handle, posted_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(componentId, post.postId, post.postUrl, post.authorHandle, post.postedAt)
    .run();
}

export async function listSourcePostsForComponent(
  db: D1Database,
  componentId: string,
): Promise<SourcePostRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM source_posts WHERE component_id = ? ORDER BY posted_at DESC")
    .bind(componentId)
    .all<SourcePostRow>();
  return results;
}

export async function updateComponentSanityPass(
  db: D1Database,
  id: string,
  commitShaChecked: string,
): Promise<void> {
  await db
    .prepare("UPDATE components SET commit_sha_checked = ? WHERE id = ?")
    .bind(commitShaChecked, id)
    .run();
}

export async function updateComponentClassification(
  db: D1Database,
  id: string,
  classification: Classification,
  categoryNodeId: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE components SET category = ?, category_node_id = ?, claims = ?, mechanism_summary = ?, cli_invocation = ?
       WHERE id = ?`,
    )
    .bind(
      classification.category,
      categoryNodeId,
      JSON.stringify(classification.claims),
      classification.mechanismSummary,
      JSON.stringify(classification.cliInvocation),
      id,
    )
    .run();
}

// Category graph ("subclades"): a self-referential node tree, open-ended
// (LLM-suggested names via Classification.suggestedCategory) rather than
// the fixed CATEGORIES enum -- see types.ts's "Category graph" comment.
// Check-then-insert, same dedupe approach as findComponentByRepo/
// insertDiscoveredComponent elsewhere in this file -- not race-proof under
// concurrent writers, an acceptable gap at this scale (one workflow run at
// a time in practice).
export async function findOrCreateCategoryNode(
  db: D1Database,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const normalized = name.trim();
  const existing = await db
    .prepare("SELECT id FROM categories WHERE name = ? AND parent_id IS ?")
    .bind(normalized, parentId)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)")
    .bind(id, normalized, parentId)
    .run();
  return id;
}

// Existing top-level clades, for the classify prompt to place a new leaf
// under (or decide none fit and propose a new one) -- see groq-client.ts's
// `suggestedParentClade` field. Capped at 30: a prompt-context list, not a
// full tree dump, and the clade count is expected to stay small relative
// to leaf categories.
export async function listTopLevelCategories(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT name FROM categories WHERE parent_id IS NULL ORDER BY name LIMIT 30")
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

export async function getCategoryNode(db: D1Database, id: string): Promise<CategoryRow | null> {
  const row = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<CategoryRow>();
  return row ?? null;
}

// README fingerprint dedup -- see src/verify/readme-fingerprint.ts. Only
// matches components that finished classification (`category IS NOT
// NULL`), and picks the earliest such match, so a chain of copies always
// resolves back to the first-seen instance of a template rather than
// whichever happened to be checked most recently.
export async function findComponentByReadmeFingerprint(
  db: D1Database,
  fingerprint: string,
  excludeId: string,
): Promise<ComponentRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM components WHERE readme_fingerprint = ? AND id != ? AND category IS NOT NULL
       ORDER BY discovered_at ASC LIMIT 1`,
    )
    .bind(fingerprint, excludeId)
    .first<ComponentRow>();
  return row ?? null;
}

export async function setReadmeFingerprint(
  db: D1Database,
  id: string,
  fingerprint: string,
  duplicateOfComponentId: string | null,
): Promise<void> {
  await db
    .prepare("UPDATE components SET readme_fingerprint = ?, duplicate_of_component_id = ? WHERE id = ?")
    .bind(fingerprint, duplicateOfComponentId, id)
    .run();
}

// Reuses an already-classified component's result verbatim (raw JSON
// columns copied as-is, no re-parse/re-stringify) rather than spending a
// fresh Groq call -- see verify-workflow.ts's classify step. Deliberately
// separate from updateComponentClassification: this is *not* an
// independent classification, and shouldn't be constructed to look like
// one (e.g. by faking a Classification object with a placeholder
// suggestedCategory).
export async function copyClassificationFromDuplicate(
  db: D1Database,
  id: string,
  duplicate: ComponentRow,
): Promise<void> {
  await db
    .prepare(
      `UPDATE components SET category = ?, category_node_id = ?, claims = ?, mechanism_summary = ?, cli_invocation = ?
       WHERE id = ?`,
    )
    .bind(
      duplicate.category,
      duplicate.category_node_id,
      duplicate.claims,
      duplicate.mechanism_summary,
      duplicate.cli_invocation,
      id,
    )
    .run();
}

// Sets status (and the tier it implies) for a tier's outcome. `terminal`
// controls whether verified_at is stamped -- callers pass the result of
// isTerminalStatus() rather than this function re-deriving it, since that
// decision also needs the category, which may not have been persisted yet
// (e.g. the sanity tier fails before classify has ever run).
export async function updateComponentStatus(
  db: D1Database,
  id: string,
  status: ComponentStatus,
  terminal: boolean,
): Promise<void> {
  const tier = tierForStatus(status);
  if (terminal) {
    await db
      .prepare(
        "UPDATE components SET status = ?, tier_reached = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(status, tier, id)
      .run();
  } else {
    await db
      .prepare("UPDATE components SET status = ?, tier_reached = ? WHERE id = ?")
      .bind(status, tier, id)
      .run();
  }
}

export interface ListComponentsResult {
  rows: ComponentRow[];
  nextCursor: string | null;
}

export async function listComponents(
  db: D1Database,
  params: ComponentsQueryParams,
): Promise<ListComponentsResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.category) {
    conditions.push("category = ?");
    binds.push(params.category);
  }
  if (params.status) {
    conditions.push("status = ?");
    binds.push(params.status);
  }

  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    conditions.push("(discovered_at < ? OR (discovered_at = ? AND id < ?))");
    binds.push(cursor.discoveredAt, cursor.discoveredAt, cursor.id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // Fetch one extra row to know whether a next page exists.
  const sql = `SELECT * FROM components ${where} ORDER BY discovered_at DESC, id DESC LIMIT ?`;
  binds.push(limit + 1);

  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<ComponentRow>();

  const hasMore = results.length > limit;
  const rows = hasMore ? results.slice(0, limit) : results;
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.discovered_at, last.id) : null;

  return { rows, nextCursor };
}

function encodeCursor(discoveredAt: string, id: string): string {
  return btoa(JSON.stringify([discoveredAt, id]));
}

function decodeCursor(cursor: string | undefined): { discoveredAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [discoveredAt, id] = JSON.parse(atob(cursor)) as [string, string];
    if (!discoveredAt || !id) return null;
    return { discoveredAt, id };
  } catch {
    return null;
  }
}

export async function listAccounts(db: D1Database): Promise<AccountRow[]> {
  const { results } = await db.prepare("SELECT * FROM accounts ORDER BY id").all<AccountRow>();
  return results;
}

// xUserId is vestigial now that polling goes through rettiwt-api (searches
// by username directly, see src/listener/x-client.ts) -- kept nullable
// rather than removed outright since it's harmless to record when known
// and some callers may still have it from the official-API era.
export async function upsertAccount(
  db: D1Database,
  handle: string,
  xUserId: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO accounts (handle, x_user_id) VALUES (?, ?)
       ON CONFLICT(handle) DO UPDATE SET x_user_id = excluded.x_user_id`,
    )
    .bind(handle, xUserId)
    .run();
}

export function parseClaims(claims: string | null): string[] {
  if (!claims) return [];
  return JSON.parse(claims) as string[];
}

export function parseCliInvocation(cliInvocation: string | null): Classification["cliInvocation"] | null {
  if (!cliInvocation) return null;
  return JSON.parse(cliInvocation) as Classification["cliInvocation"];
}

export function parseCategory(category: string | null): Category | null {
  return (category as Category | null) ?? null;
}
