import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { handleRawPostsBatch } from "./extract-consumer";
import { findComponentByRepo, listSourcePostsForComponent } from "../catalog/components-repo";
import type { Env, RawPostMessage } from "../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
});

function fakeMessage(body: RawPostMessage) {
  return {
    id: body.postId,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return {
    queue: "raw-posts",
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<RawPostMessage>;
}

describe("handleRawPostsBatch", () => {
  it("inserts a new component and acks on first sighting of a repo", async () => {
    const msg = fakeMessage({
      postId: "p1",
      postUrl: "https://x.com/alice/status/p1",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-01-01T00:00:00Z",
      urls: ["https://github.com/acme/widget"],
    });
    const batch = fakeBatch([msg]);

    await handleRawPostsBatch(batch, testEnv);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();

    const component = await findComponentByRepo(testEnv.DB, "acme", "widget");
    expect(component).not.toBeNull();
    expect(component?.status).toBe("discovered");

    const posts = await listSourcePostsForComponent(testEnv.DB, component!.id);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.author_handle).toBe("alice");
  });

  it("appends a source post instead of re-inserting when the repo is already known", async () => {
    const first = fakeMessage({
      postId: "p1",
      postUrl: "https://x.com/alice/status/p1",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-01-01T00:00:00Z",
      urls: ["https://github.com/acme/widget"],
    });
    await handleRawPostsBatch(fakeBatch([first]), testEnv);

    const second = fakeMessage({
      postId: "p2",
      postUrl: "https://x.com/bob/status/p2",
      authorHandle: "bob",
      authorUserId: "u2",
      postedAt: "2026-01-02T00:00:00Z",
      urls: ["https://github.com/acme/widget"],
    });
    await handleRawPostsBatch(fakeBatch([second]), testEnv);

    const component = await findComponentByRepo(testEnv.DB, "acme", "widget");
    const posts = await listSourcePostsForComponent(testEnv.DB, component!.id);
    expect(posts).toHaveLength(2);
  });

  it("skips a message with no GitHub links but still acks it", async () => {
    const msg = fakeMessage({
      postId: "p1",
      postUrl: "https://x.com/alice/status/p1",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-01-01T00:00:00Z",
      urls: ["https://example.com/not-a-repo"],
    });
    await handleRawPostsBatch(fakeBatch([msg]), testEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("retries (not acks) a message whose processing throws, and does not affect other messages in the batch", async () => {
    const badMessage = fakeMessage({
      postId: "bad",
      postUrl: "https://x.com/alice/status/bad",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-01-01T00:00:00Z",
      urls: ["https://github.com/acme/widget"],
    });
    const goodMessage = fakeMessage({
      postId: "good",
      postUrl: "https://x.com/bob/status/good",
      authorHandle: "bob",
      authorUserId: "u2",
      postedAt: "2026-01-01T00:00:00Z",
      urls: ["https://github.com/acme/other"],
    });

    const originalFindComponentByRepo = testEnv.DB.prepare;
    const spy = vi
      .spyOn(testEnv.DB, "prepare")
      .mockImplementationOnce(() => {
        throw new Error("simulated DB failure");
      })
      .mockImplementation((...args) => originalFindComponentByRepo.apply(testEnv.DB, args));

    await handleRawPostsBatch(fakeBatch([badMessage, goodMessage]), testEnv);

    expect(badMessage.retry).toHaveBeenCalledOnce();
    expect(badMessage.ack).not.toHaveBeenCalled();
    expect(goodMessage.ack).toHaveBeenCalledOnce();

    spy.mockRestore();
  });

  it("dedupes multiple links in one post that resolve to the same repo", async () => {
    const msg = fakeMessage({
      postId: "p1",
      postUrl: "https://x.com/alice/status/p1",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-01-01T00:00:00Z",
      urls: [
        "https://github.com/acme/widget",
        "https://github.com/acme/widget/tree/main/packages/core",
      ],
    });
    await handleRawPostsBatch(fakeBatch([msg]), testEnv);

    const component = await findComponentByRepo(testEnv.DB, "acme", "widget");
    const posts = await listSourcePostsForComponent(testEnv.DB, component!.id);
    expect(posts).toHaveLength(1); // one post, one source_posts row, despite two links resolving to it
  });
});
