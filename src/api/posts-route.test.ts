import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredComponent } from "../catalog/components-repo";
import { getPost, insertPendingPost } from "../catalog/posts-repo";
import { handleAdminApprovePost, handleAdminListPosts, handleAdminRejectPost } from "./posts-route";
import type { Env } from "../types";

// Same rationale as listener-agent.test.ts: postTweet's own internals are
// covered on their own terms in x-client.test.ts. This file is about what
// the approve/reject handlers do around a post call, not about re-proving
// the X client itself -- and mocking here sidesteps rettiwt-api's
// documented ESM-loader incompatibility with this test runner.
const postTweetMock = vi.fn();
vi.mock("../listener/x-client", () => ({
  createXClient: vi.fn(() => ({})),
  postTweet: (...args: unknown[]) => postTweetMock(...args),
}));

const testEnv = env as unknown as Env;
const originalPostingEnabled = testEnv.X_POSTING_ENABLED;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
  postTweetMock.mockReset();
  testEnv.X_POSTING_ENABLED = "true";
  await insertDiscoveredComponent(testEnv.DB, {
    id: "c1",
    name: "widget",
    repoOwner: "acme",
    repoName: "widget",
    repoUrl: "https://github.com/acme/widget",
    evidencePrefix: "evidence/c1/",
  });
});

afterEach(() => {
  testEnv.X_POSTING_ENABLED = originalPostingEnabled;
});

function adminRequest(path: string, token = testEnv.ADMIN_TOKEN) {
  return new Request(`https://xapi.example${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("handleAdminListPosts", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminListPosts(
      new Request("https://xapi.example/admin/posts", { headers: { authorization: "Bearer wrong" } }),
      testEnv,
    );
    expect(res.status).toBe(401);
  });

  it("lists posts, optionally filtered by status", async () => {
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });
    const res = await handleAdminListPosts(
      new Request("https://xapi.example/admin/posts?status=pending", {
        headers: { authorization: `Bearer ${testEnv.ADMIN_TOKEN}` },
      }),
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((p) => p.id)).toEqual(["p1"]);
  });

  it("400s on an unknown status", async () => {
    const res = await handleAdminListPosts(
      new Request("https://xapi.example/admin/posts?status=bogus", {
        headers: { authorization: `Bearer ${testEnv.ADMIN_TOKEN}` },
      }),
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});

describe("handleAdminApprovePost", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve", "wrong"), testEnv, "p1");
    expect(res.status).toBe(401);
  });

  it("403s when X_POSTING_ENABLED is not set, even with a pending draft", async () => {
    testEnv.X_POSTING_ENABLED = "";
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });
    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");
    expect(res.status).toBe(403);
    expect(postTweetMock).not.toHaveBeenCalled();
  });

  it("404s on an unknown post id", async () => {
    const res = await handleAdminApprovePost(adminRequest("/admin/posts/missing/approve"), testEnv, "missing");
    expect(res.status).toBe(404);
  });

  it("posts a pending draft and marks it posted", async () => {
    postTweetMock.mockResolvedValue("tweet-123");
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });

    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");
    expect(res.status).toBe(200);
    expect(postTweetMock).toHaveBeenCalledWith(expect.anything(), "hi", "t1");

    const post = await getPost(testEnv.DB, "p1");
    expect(post?.status).toBe("posted");
    expect(post?.posted_at).not.toBeNull();
  });

  it("marks the post post_failed, without retrying, when postTweet throws", async () => {
    postTweetMock.mockRejectedValue(new Error("X is down"));
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });

    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");
    expect(res.status).toBe(502);
    expect(postTweetMock).toHaveBeenCalledTimes(1);

    const post = await getPost(testEnv.DB, "p1");
    expect(post?.status).toBe("post_failed");
    expect(post?.error).toBe("X is down");
  });

  it("409s when approving a post that isn't pending", async () => {
    postTweetMock.mockResolvedValue("tweet-123");
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });
    await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");

    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");
    expect(res.status).toBe(409);
    expect(postTweetMock).toHaveBeenCalledTimes(1);
  });

  it("429s inside the cooldown window after a successful post", async () => {
    postTweetMock.mockResolvedValue("tweet-1");
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "first" });
    await handleAdminApprovePost(adminRequest("/admin/posts/p1/approve"), testEnv, "p1");

    await insertPendingPost(testEnv.DB, { id: "p2", componentId: "c1", replyToTweetId: "t2", text: "second" });
    const res = await handleAdminApprovePost(adminRequest("/admin/posts/p2/approve"), testEnv, "p2");
    expect(res.status).toBe(429);
    expect(postTweetMock).toHaveBeenCalledTimes(1);

    const post = await getPost(testEnv.DB, "p2");
    expect(post?.status).toBe("pending");
  });
});

describe("handleAdminRejectPost", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminRejectPost(adminRequest("/admin/posts/p1/reject", "wrong"), testEnv, "p1");
    expect(res.status).toBe(401);
  });

  it("marks a pending post rejected", async () => {
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });
    const res = await handleAdminRejectPost(adminRequest("/admin/posts/p1/reject"), testEnv, "p1");
    expect(res.status).toBe(200);
    const post = await getPost(testEnv.DB, "p1");
    expect(post?.status).toBe("rejected");
    expect(postTweetMock).not.toHaveBeenCalled();
  });

  it("409s when rejecting a post that isn't pending", async () => {
    await insertPendingPost(testEnv.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hi" });
    await handleAdminRejectPost(adminRequest("/admin/posts/p1/reject"), testEnv, "p1");
    const res = await handleAdminRejectPost(adminRequest("/admin/posts/p1/reject"), testEnv, "p1");
    expect(res.status).toBe(409);
  });
});
