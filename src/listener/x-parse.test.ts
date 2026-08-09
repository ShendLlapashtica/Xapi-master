import { describe, expect, it } from "vitest";
import { tweetToRawPosts } from "./x-parse";

describe("tweetToRawPosts", () => {
  it("extracts urls from a plain (non-repost) tweet", () => {
    expect(
      tweetToRawPosts({
        id: "1",
        createdAt: "2026-08-01T00:00:00.000Z",
        tweetBy: { userName: "alice", id: "u1" },
        entities: { urls: ["https://github.com/acme/widget"] },
      }),
    ).toEqual([
      {
        postId: "1",
        postUrl: "https://x.com/alice/status/1",
        authorHandle: "alice",
        authorUserId: "u1",
        postedAt: "2026-08-01T00:00:00.000Z",
        urls: ["https://github.com/acme/widget"],
      },
    ]);
  });

  it("resolves a retweet's urls from the nested retweetedTweet", () => {
    const result = tweetToRawPosts({
      id: "2",
      createdAt: "2026-08-02T00:00:00.000Z",
      tweetBy: { userName: "alice", id: "u1" }, // the tracked account that reposted
      entities: undefined, // retweet's own object carries no useful entities
      retweetedTweet: {
        id: "100",
        tweetBy: { userName: "bob", id: "u2" },
        entities: { urls: ["https://github.com/acme/other"] },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      postId: "2", // the repost's own id, not the original's
      authorHandle: "alice", // attributed to the tracked account that reposted
      urls: ["https://github.com/acme/other"],
    });
  });

  it("uses the quote tweet's own entities, not a nested tweet's", () => {
    const result = tweetToRawPosts({
      id: "3",
      tweetBy: { userName: "alice", id: "u1" },
      entities: { urls: ["https://github.com/acme/mine"] },
    });
    expect(result[0]?.urls).toEqual(["https://github.com/acme/mine"]);
  });

  it("skips a tweet with no urls at all", () => {
    expect(tweetToRawPosts({ id: "4", tweetBy: { userName: "alice" } })).toEqual([]);
  });

  it("falls back to an empty author handle when tweetBy is missing", () => {
    const result = tweetToRawPosts({
      id: "5",
      entities: { urls: ["https://github.com/acme/widget"] },
    });
    expect(result[0]?.authorHandle).toBe("");
    expect(result[0]?.postUrl).toBe("https://x.com/i/status/5");
  });
});
