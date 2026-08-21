import { upsertAccount } from "../catalog/components-repo";
import { discoverRepo } from "../extract/extract-consumer";
import { canonicalizeGithubUrl } from "../extract/github-url";
import { findDomainByHostname, insertDiscoveredDomain, setDomainWatched } from "../catalog/domains-repo";
import { backfillCategoryForComponent } from "../verify/backfill-category";
import type { Env } from "../types";

interface SeedAccountsBody {
  // xUserId is vestigial (see components-repo.ts's upsertAccount) -- kept
  // optional here rather than dropped so old callers/scripts that still
  // send it don't break.
  accounts: Array<{ handle: string; xUserId?: string }>;
}

interface VerifyRepoBody {
  repoUrl: string;
}

interface BackfillCategoryBody {
  componentIds: string[];
}

interface AuditDomainBody {
  hostname: string; // e.g. "autokoreablendi.com" or "https://autokoreablendi.com"
  // Marks the domain as belonging to DomainAuditAgent's recurring work list
  // (see src/audit/domain-audit-agent.ts) instead of just this one-off run.
  // Reuses this route rather than adding a new one -- watching is a
  // property of a domain this route already discovers/audits, not a
  // separate concern.
  watched?: boolean;
}

export function isAuthorized(request: Request, env: Env): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  return Boolean(env.ADMIN_TOKEN) && authHeader === `Bearer ${env.ADMIN_TOKEN}`;
}

// Scoped tier for read-only admin routes (currently just GET /admin/posts)
// -- accepts ADMIN_TOKEN (a superset) or the separate ADMIN_READONLY_TOKEN,
// so a second person can be handed read access to the posts queue without
// holding the credential that can approve/reject posts, seed accounts, or
// trigger workflows. ADMIN_READONLY_TOKEN is optional; unset, only
// ADMIN_TOKEN works here, same as before this tier existed. See README.md's
// "Admin token operations".
export function isReadAuthorized(request: Request, env: Env): boolean {
  if (isAuthorized(request, env)) return true;
  const authHeader = request.headers.get("authorization") ?? "";
  return Boolean(env.ADMIN_READONLY_TOKEN) && authHeader === `Bearer ${env.ADMIN_READONLY_TOKEN}`;
}

// Manual stand-in for the Listen stage (BRIEF.md's ListenerAgent) when
// there's no X API access to actually discover posts -- feeds a GitHub repo
// straight into the same discoverRepo() path a real post's link would hit,
// so extract/dedupe/verify all run exactly as they would from a live post.
export async function handleAdminVerifyRepo(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: VerifyRepoBody;
  try {
    body = (await request.json()) as VerifyRepoBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.repoUrl) {
    return Response.json({ error: "body.repoUrl is required" }, { status: 400 });
  }

  const canonical = canonicalizeGithubUrl(body.repoUrl);
  if (!canonical) {
    return Response.json({ error: `not a recognizable GitHub repo URL: ${body.repoUrl}` }, { status: 400 });
  }

  const result = await discoverRepo(
    canonical,
    {
      postId: `manual-${crypto.randomUUID()}`,
      postUrl: "manual-trigger",
      authorHandle: "admin",
      postedAt: new Date().toISOString(),
    },
    env,
  );

  return Response.json({
    componentId: result.componentId,
    isNew: result.isNew,
    message: result.isNew
      ? "component discovered, verification workflow enqueued"
      : "repo already known -- source post recorded, no new verification run started",
  });
}

// See diligence/2026-08-09-category-node-id-backfill-gap.md and
// src/verify/backfill-category.ts's file comment for the full "why". Runs
// sequentially, not in parallel -- each non-duplicate row costs a Groq
// call, and Groq's free-tier token budget is shared across concurrent
// requests (same constraint verify-workflow.ts's classify-llm step
// guards against). A batch of 20 rows can take several minutes if
// several land on the non-duplicate/backoff path; that's expected, not a
// bug -- this is an admin-triggered one-off, not a request in the
// critical path of anything.
export async function handleAdminBackfillCategory(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: BackfillCategoryBody;
  try {
    body = (await request.json()) as BackfillCategoryBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.componentIds) || body.componentIds.length === 0) {
    return Response.json({ error: "body.componentIds must be a non-empty array" }, { status: 400 });
  }

  const results = [];
  for (const componentId of body.componentIds) {
    results.push(await backfillCategoryForComponent(env, componentId));
  }

  return Response.json({ results });
}

/** Canonicalize a hostname input: strip scheme, path, and trailing slashes. */
function canonicalizeHostname(input: string): string | null {
  let h = input.trim().toLowerCase();
  // Strip scheme
  h = h.replace(/^https?:\/\//, "");
  // Strip path and query
  h = h.split("/")[0] ?? "";
  h = h.split("?")[0] ?? "";
  // Basic validation: must have at least one dot and only valid chars
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return null;
  return h;
}

// Trigger a domain security audit without going through any external source --
// useful for auditing your own sites or any domain you want in the knowledge graph.
export async function handleAdminAuditDomain(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: AuditDomainBody;
  try {
    body = (await request.json()) as AuditDomainBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.hostname) {
    return Response.json({ error: "body.hostname is required" }, { status: 400 });
  }

  const hostname = canonicalizeHostname(body.hostname);
  if (!hostname) {
    return Response.json({ error: `not a valid hostname: ${body.hostname}` }, { status: 400 });
  }

  // Find or create domain row
  const existing = await findDomainByHostname(env.DB, hostname);
  let domainId: string;
  let isNew: boolean;

  if (existing) {
    domainId = existing.id;
    isNew = false;
  } else {
    domainId = crypto.randomUUID();
    await insertDiscoveredDomain(env.DB, domainId, hostname);
    isNew = true;
  }

  if (body.watched !== undefined) {
    await setDomainWatched(env.DB, domainId, body.watched);
  }

  // Trigger a fresh audit workflow. Use a timestamped id so re-auditing
  // the same domain creates a new workflow instance (not a duplicate-id conflict).
  const workflowId = `domain-audit-${domainId}-${Date.now()}`;
  await env.DOMAIN_AUDIT_WORKFLOW.create({
    id: workflowId,
    params: { domainId, hostname },
  });

  return Response.json({
    domainId,
    hostname,
    isNew,
    workflowId,
    message: isNew
      ? "domain discovered, audit workflow triggered"
      : "domain already known -- re-audit triggered",
  });
}

// x_user_id is pre-resolved offline (see seed/accounts.seed.json / scripts/seed-accounts.ts)
// rather than looked up live here -- resolving handles is a one-time setup
// task, not pipeline logic, and keeping it out of this route keeps the
// route testable without mocking the X API.
export async function handleAdminAccountsSeed(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: SeedAccountsBody;
  try {
    body = (await request.json()) as SeedAccountsBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
    return Response.json({ error: "body.accounts must be a non-empty array" }, { status: 400 });
  }

  for (const account of body.accounts) {
    if (!account.handle) {
      return Response.json({ error: "each account requires a handle" }, { status: 400 });
    }
  }

  for (const account of body.accounts) {
    await upsertAccount(env.DB, account.handle.trim().replace(/^@/, ""), account.xUserId ?? null);
  }

  return Response.json({ seeded: body.accounts.length });
}
