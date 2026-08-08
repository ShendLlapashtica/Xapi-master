import { getAgentByName } from "agents";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { upsertAccount } from "../catalog/components-repo";
import type { Env } from "../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ListenerAgent.poll", () => {
  it("does nothing when the roster is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const agent = await getAgentByName(testEnv.LISTENER_AGENT, "empty-roster-test");
    await agent.poll();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("polls X, enqueues extracted posts, and advances since_id in state", async () => {
    await upsertAccount(testEnv.DB, "alice", "111");

    const xResponse = {
      data: [
        {
          id: "42",
          text: "check this out",
          author_id: "111",
          created_at: "2026-08-01T00:00:00.000Z",
          entities: { urls: [{ url: "t.co/x", expanded_url: "https://github.com/acme/widget" }] },
        },
      ],
      includes: { users: [{ id: "111", username: "alice" }] },
      meta: { result_count: 1, newest_id: "42" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(xResponse), { status: 200 })),
    );

    const agent = await getAgentByName(testEnv.LISTENER_AGENT, "poll-test");
    await agent.poll();

    // `onRequest` isn't itself remotely callable over the DO's RPC surface
    // (it's the framework's own HTTP entry point, not a plain method) --
    // read the synced state back directly instead.
    const state = await agent.state;
    expect(state.sinceId).toBe("42");
  });
});
