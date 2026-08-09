import { describe, expect, it, vi } from "vitest";
import { pollAccounts, type XPollClient } from "./x-client";

// rettiwt-auth (a transitive dep, itself flagged deprecated on npm) does a
// default import of `https-proxy-agent`, which has shipped named exports
// only since v5 -- real, upstream, confirmed via that package's own
// package.json, not a guess. esbuild's bundler shims this correctly (the
// actual deployed Worker starts fine under `wrangler dev`, checked
// directly), but vitest-pool-workers' stricter ESM loader throws on it at
// import time. Mocking the module here (vi.mock calls are hoisted above
// the import above, so x-client.ts's own `from "rettiwt-api"` resolves to
// this instead) tests pollAccounts' own logic without dragging that real,
// broken-only-under-this-test-runner import chain into the test graph.
vi.mock("rettiwt-api", () => ({
  Rettiwt: class {},
  TweetFilter: class {
    constructor(fields: Record<string, unknown>) {
      Object.assign(this, fields);
    }
  },
}));

function fakeClient(list: unknown[]): XPollClient {
  return { tweet: { search: vi.fn(async () => ({ list, next: { value: "" } })) } as never };
}

describe("pollAccounts", () => {
  it("returns nothing and skips the call entirely for an empty roster", async () => {
    const client = fakeClient([]);
    const result = await pollAccounts(client, [], undefined);
    expect(result).toEqual({ messages: [], newestId: undefined });
    expect(client.tweet.search).not.toHaveBeenCalled();
  });

  it("passes the roster, sinceId, and link/reply filters through to search", async () => {
    const client = fakeClient([]);
    await pollAccounts(client, ["alice", "bob"], "999");

    const filterArg = (client.tweet.search as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(filterArg.fromUsers).toEqual(["alice", "bob"]);
    expect(filterArg.sinceId).toBe("999");
    expect(filterArg.replies).toBe(false);
    expect(filterArg.links).toBe(true);
  });

  it("maps matched tweets to RawPostMessages and advances newestId to the highest id seen", async () => {
    const client = fakeClient([
      {
        id: "42",
        createdAt: "2026-08-01T00:00:00.000Z",
        tweetBy: { userName: "alice", id: "u1" },
        entities: { urls: ["https://github.com/acme/widget"] },
      },
      {
        id: "7", // lower than 42 -- newestId must not regress to this
        tweetBy: { userName: "alice", id: "u1" },
        entities: { urls: ["https://github.com/acme/old"] },
      },
    ]);

    const result = await pollAccounts(client, ["alice"], undefined);
    expect(result.newestId).toBe("42");
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.postId)).toEqual(["42", "7"]);
  });

  it("keeps the prior sinceId as newestId when nothing new came back", async () => {
    const client = fakeClient([]);
    const result = await pollAccounts(client, ["alice"], "500");
    expect(result.newestId).toBe("500");
  });

  it("drops tweets with no urls out of the messages list", async () => {
    const client = fakeClient([{ id: "1", tweetBy: { userName: "alice" } }]);
    const result = await pollAccounts(client, ["alice"], undefined);
    expect(result.messages).toEqual([]);
    // still advances the cursor even though nothing was extracted, so a
    // quiet/no-link-having tweet doesn't get re-scanned forever
    expect(result.newestId).toBe("1");
  });
});
