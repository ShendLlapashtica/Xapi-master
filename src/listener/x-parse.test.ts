import { describe, expect, it } from "vitest";
import { extractRawPosts } from "./x-parse";
import type { XSearchResponse } from "./x-client.types";

describe("extractRawPosts", () => {
  it("returns an empty array when there is no data", () => {
    expect(extractRawPosts({ meta: { result_count: 0 } })).toEqual([]);
  });

  it("extracts urls from a plain (non-repost) tweet", () => {
    const response: XSearchResponse = {
      data: [
        {
          id: "1",
          text: "check this out",
          author_id: "u1",
          created_at: "2026-08-01T00:00:00.000Z",
          entities: { urls: [{ url: "t.co/x", expanded_url: "https://github.com/acme/widget" }] },
        },
      ],
      includes: { users: [{ id: "u1", username: "alice" }] },
      meta: { result_count: 1 },
    };
    expect(extractRawPosts(response)).toEqual([
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

  it("resolves a retweet's URLs from the original tweet via referenced_tweets/includes", () => {
    const response: XSearchResponse = {
      data: [
        {
          id: "2",
          text: "RT @bob: check this out",
          author_id: "u1", // the tracked account that reposted
          created_at: "2026-08-02T00:00:00.000Z",
          entities: undefined, // retweet's own object carries no useful entities
          referenced_tweets: [{ type: "retweeted", id: "100" }],
        },
      ],
      includes: {
        tweets: [
          {
            id: "100",
            text: "check this out",
            author_id: "u2",
            entities: { urls: [{ url: "t.co/y", expanded_url: "https://github.com/acme/other" }] },
          },
        ],
        users: [
          { id: "u1", username: "alice" },
          { id: "u2", username: "bob" },
        ],
      },
      meta: { result_count: 1 },
    };
    const result = extractRawPosts(response);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      postId: "2",
      authorHandle: "alice", // attributed to the tracked account that reposted, not the original author
      urls: ["https://github.com/acme/other"],
    });
  });

  it("uses the quote tweet's own entities, not the quoted tweet's", () => {
    const response: XSearchResponse = {
      data: [
        {
          id: "3",
          text: "worth a look",
          author_id: "u1",
          entities: { urls: [{ url: "t.co/z", expanded_url: "https://github.com/acme/mine" }] },
          referenced_tweets: [{ type: "quoted", id: "200" }],
        },
      ],
      includes: {
        tweets: [
          {
            id: "200",
            text: "original",
            author_id: "u2",
            entities: { urls: [{ url: "t.co/w", expanded_url: "https://github.com/acme/theirs" }] },
          },
        ],
        users: [{ id: "u1", username: "alice" }],
      },
      meta: { result_count: 1 },
    };
    const result = extractRawPosts(response);
    expect(result[0]?.urls).toEqual(["https://github.com/acme/mine"]);
  });

  it("skips a tweet with no URLs at all", () => {
    const response: XSearchResponse = {
      data: [{ id: "4", text: "no links here", author_id: "u1" }],
      includes: { users: [{ id: "u1", username: "alice" }] },
      meta: { result_count: 1 },
    };
    expect(extractRawPosts(response)).toEqual([]);
  });

  it("falls back to the raw author id when the user isn't in includes", () => {
    const response: XSearchResponse = {
      data: [
        {
          id: "5",
          text: "x",
          author_id: "u9",
          entities: { urls: [{ url: "t.co/x", expanded_url: "https://github.com/acme/widget" }] },
        },
      ],
      meta: { result_count: 1 },
    };
    expect(extractRawPosts(response)[0]?.authorHandle).toBe("u9");
  });
});
