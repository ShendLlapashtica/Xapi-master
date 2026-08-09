import { getAgentByName } from "agents";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { upsertAccount } from "../catalog/components-repo";
import type { Env } from "../types";

// ListenerAgent's own job is orchestration (roster -> client -> cursor ->
// queue), not the X polling/mapping logic itself -- that's covered on its
// own terms in x-client.test.ts against an injected fake. Mocking the
// whole module here keeps this file about what ListenerAgent does with
// what the client returns, not about re-proving the client's internals.
const pollAccountsMock = vi.fn();
vi.mock("./x-client", () => ({
  createXClient: vi.fn(() => ({})),
  pollAccounts: (...args: unknown[]) => pollAccountsMock(...args),
}));

const testEnv = env as unknown as Env;
const originalRawPosts = testEnv.RAW_POSTS;
const originalSessionToken = testEnv.X_SESSION_TOKEN;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
  pollAccountsMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  testEnv.RAW_POSTS = originalRawPosts;
  testEnv.X_SESSION_TOKEN = originalSessionToken;
});

describe("ListenerAgent.poll", () => {
  it("does nothing when X_SESSION_TOKEN is unset", async () => {
    testEnv.X_SESSION_TOKEN = "";
    const agent = await getAgentByName(testEnv.LISTENER_AGENT, "no-token-test");
    await agent.poll();
    expect(pollAccountsMock).not.toHaveBeenCalled();
  });

  it("does nothing when the roster is empty", async () => {
    testEnv.X_SESSION_TOKEN = "test-session-token";
    const agent = await getAgentByName(testEnv.LISTENER_AGENT, "empty-roster-test");
    await agent.poll();
    expect(pollAccountsMock).not.toHaveBeenCalled();
  });

  it("polls with normalized handles, enqueues messages, and advances since_id in state", async () => {
    testEnv.X_SESSION_TOKEN = "test-session-token";
    await upsertAccount(testEnv.DB, "@alice", null);

    const message = {
      postId: "42",
      postUrl: "https://x.com/alice/status/42",
      authorHandle: "alice",
      authorUserId: "u1",
      postedAt: "2026-08-01T00:00:00.000Z",
      urls: ["https://github.com/acme/widget"],
    };
    pollAccountsMock.mockResolvedValue({ messages: [message], newestId: "42" });

    const sendSpy = vi.fn();
    testEnv.RAW_POSTS = { send: sendSpy } as never;

    const agent = await getAgentByName(testEnv.LISTENER_AGENT, "poll-test");
    await agent.poll();

    expect(pollAccountsMock).toHaveBeenCalledWith(expect.anything(), ["alice"], undefined);
    expect(sendSpy).toHaveBeenCalledWith(message);

    // `onRequest` isn't itself remotely callable over the DO's RPC surface
    // (it's the framework's own HTTP entry point, not a plain method) --
    // read the synced state back directly instead.
    const state = await agent.state;
    expect(state.sinceId).toBe("42");
  });
});
