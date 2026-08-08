import { upsertAccount } from "../catalog/components-repo";
import { discoverRepo } from "../extract/extract-consumer";
import { canonicalizeGithubUrl } from "../extract/github-url";
import type { Env } from "../types";

interface SeedAccountsBody {
  accounts: Array<{ handle: string; xUserId: string }>;
}

interface VerifyRepoBody {
  repoUrl: string;
}

function isAuthorized(request: Request, env: Env): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  return Boolean(env.ADMIN_TOKEN) && authHeader === `Bearer ${env.ADMIN_TOKEN}`;
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
    if (!account.handle || !account.xUserId) {
      return Response.json(
        { error: "each account requires handle and xUserId" },
        { status: 400 },
      );
    }
  }

  for (const account of body.accounts) {
    await upsertAccount(env.DB, account.handle.trim().replace(/^@/, ""), account.xUserId);
  }

  return Response.json({ seeded: body.accounts.length });
}
