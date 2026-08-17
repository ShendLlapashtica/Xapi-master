import { isAuthorized } from "./admin-route";
import {
  POST_STATUSES,
  getMostRecentlyPostedAt,
  getPost,
  listPosts,
  markPostFailed,
  markPostPosted,
  markPostRejected,
  type PostStatus,
} from "../catalog/posts-repo";
import { createXClient, postTweet } from "../listener/x-client";
import type { Env } from "../types";

// Caps the account at roughly 48 posts/day even under a throughput burst --
// a burst of manually-triggered verifications finishing close together is
// the most bot-like, most suspension-risky posting pattern for a scraping
// -based X client (see README.md's "X integration": this account "can get
// rate-limited or suspended"). Rarely blocks a human spacing approvals
// through a workday.
const COOLDOWN_MINUTES = 30;

function isStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

export async function handleAdminListPosts(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor") ?? undefined;

  let status: PostStatus | undefined;
  if (statusParam !== null) {
    if (!isStatus(statusParam)) {
      return Response.json({ error: `unknown status: ${statusParam}` }, { status: 400 });
    }
    status = statusParam;
  }

  const { rows, nextCursor } = await listPosts(env.DB, {
    status,
    limit: limitParam ? Number(limitParam) : undefined,
    cursor: cursorParam,
  });

  return Response.json({ items: rows, nextCursor });
}

export async function handleAdminApprovePost(request: Request, env: Env, id: string): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Kill switch: checked fresh on every call, same mechanism as
  // X_SESSION_TOKEN (a secret, no redeploy needed to flip it). Absent or
  // not exactly "true" means posting is off, even with a pending draft and
  // a valid session token.
  if (env.X_POSTING_ENABLED !== "true") {
    return Response.json({ error: "posting is disabled (X_POSTING_ENABLED is not set)" }, { status: 403 });
  }

  const post = await getPost(env.DB, id);
  if (!post) {
    return new Response("Not found", { status: 404 });
  }
  if (post.status !== "pending") {
    return Response.json({ error: `post ${id} is already ${post.status}` }, { status: 409 });
  }

  const lastPostedAt = await getMostRecentlyPostedAt(env.DB);
  if (lastPostedAt) {
    const elapsedMs = Date.now() - new Date(lastPostedAt).getTime();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
    if (elapsedMs < cooldownMs) {
      const retryAfterSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      return Response.json(
        { error: `cooldown active, ${retryAfterSeconds}s remaining` },
        { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
      );
    }
  }

  try {
    const client = createXClient(env.X_SESSION_TOKEN);
    await postTweet(client, post.text, post.reply_to_tweet_id);
  } catch (err) {
    // Deliberately no retry, same reasoning the code this replaced used:
    // X's own response can fail/time out *after* the reply already went
    // through server-side, so a retry here risks a second real reply to
    // the same tweet. This is a one-shot admin action, not a Workflow
    // step, but the risk and the mitigation are identical.
    const message = err instanceof Error ? err.message : String(err);
    await markPostFailed(env.DB, id, message);
    return Response.json({ error: `failed to post: ${message}` }, { status: 502 });
  }

  await markPostPosted(env.DB, id);
  return Response.json({ id, status: "posted" });
}

export async function handleAdminRejectPost(request: Request, env: Env, id: string): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const post = await getPost(env.DB, id);
  if (!post) {
    return new Response("Not found", { status: 404 });
  }
  if (post.status !== "pending") {
    return Response.json({ error: `post ${id} is already ${post.status}` }, { status: 409 });
  }

  await markPostRejected(env.DB, id);
  return Response.json({ id, status: "rejected" });
}
