import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredComponent } from "./components-repo";
import {
  getMostRecentlyPostedAt,
  getPost,
  insertPendingPost,
  listPosts,
  markPostFailed,
  markPostPosted,
  markPostRejected,
} from "./posts-repo";

beforeEach(async () => {
  await resetSchema(env.DB);
  await insertDiscoveredComponent(env.DB, {
    id: "c1",
    name: "widget",
    repoOwner: "acme",
    repoName: "widget",
    repoUrl: "https://github.com/acme/widget",
    evidencePrefix: "evidence/c1/",
  });
});

describe("posts-repo", () => {
  it("inserts a pending post and reads it back", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hello" });
    const post = await getPost(env.DB, "p1");
    expect(post?.status).toBe("pending");
    expect(post?.text).toBe("hello");
    expect(post?.posted_at).toBeNull();
  });

  it("marks a post posted", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hello" });
    await markPostPosted(env.DB, "p1");
    const post = await getPost(env.DB, "p1");
    expect(post?.status).toBe("posted");
    expect(post?.posted_at).not.toBeNull();
  });

  it("marks a post rejected", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hello" });
    await markPostRejected(env.DB, "p1");
    const post = await getPost(env.DB, "p1");
    expect(post?.status).toBe("rejected");
  });

  it("marks a post failed with the error message", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "hello" });
    await markPostFailed(env.DB, "p1", "rate limited");
    const post = await getPost(env.DB, "p1");
    expect(post?.status).toBe("post_failed");
    expect(post?.error).toBe("rate limited");
  });

  it("finds the most recently posted timestamp across multiple posted rows", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "first" });
    await markPostPosted(env.DB, "p1");
    await new Promise((r) => setTimeout(r, 5));
    await insertPendingPost(env.DB, { id: "p2", componentId: "c1", replyToTweetId: "t2", text: "second" });
    await markPostPosted(env.DB, "p2");

    const latest = await getMostRecentlyPostedAt(env.DB);
    const p2 = await getPost(env.DB, "p2");
    expect(latest).toBe(p2?.posted_at);
  });

  it("ignores pending/rejected posts when finding the most recently posted timestamp", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "pending" });
    expect(await getMostRecentlyPostedAt(env.DB)).toBeNull();
  });

  it("lists posts filtered by status", async () => {
    await insertPendingPost(env.DB, { id: "p1", componentId: "c1", replyToTweetId: "t1", text: "a" });
    await insertPendingPost(env.DB, { id: "p2", componentId: "c1", replyToTweetId: "t2", text: "b" });
    await markPostPosted(env.DB, "p2");

    const pending = await listPosts(env.DB, { status: "pending" });
    expect(pending.rows.map((r) => r.id)).toEqual(["p1"]);

    const posted = await listPosts(env.DB, { status: "posted" });
    expect(posted.rows.map((r) => r.id)).toEqual(["p2"]);
  });
});
