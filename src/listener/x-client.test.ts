import { describe, expect, it, vi } from "vitest";
import { searchRecent } from "./x-client";
import { jsonFetch } from "../../test/helpers/mock-fetch";

describe("searchRecent", () => {
  it("builds the request with query, expansions, fields, and bearer auth", async () => {
    const fetchImpl = jsonFetch(200, { meta: { result_count: 0 } });
    await searchRecent("(from:alice) -is:reply", undefined, { bearerToken: "tok", fetchImpl });

    const [urlArg, initArg] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const url = new URL(urlArg);
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/search/recent");
    expect(url.searchParams.get("query")).toBe("(from:alice) -is:reply");
    expect(url.searchParams.get("expansions")).toBe("referenced_tweets.id,author_id");
    expect(url.searchParams.get("tweet.fields")).toBe("entities,created_at");
    expect(url.searchParams.has("since_id")).toBe(false);
    expect((initArg.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("includes since_id when provided", async () => {
    const fetchImpl = jsonFetch(200, { meta: { result_count: 0 } });
    await searchRecent("(from:alice) -is:reply", "12345", { bearerToken: "tok", fetchImpl });
    const [urlArg] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(new URL(urlArg).searchParams.get("since_id")).toBe("12345");
  });

  it("returns the parsed response on success", async () => {
    const payload = { meta: { result_count: 1 }, data: [{ id: "1", text: "hi" }] };
    const fetchImpl = jsonFetch(200, payload);
    const result = await searchRecent("q", undefined, { bearerToken: "tok", fetchImpl });
    expect(result).toEqual(payload);
  });

  it("throws with status and body on a non-ok response", async () => {
    const fetchImpl = jsonFetch(429, { title: "Too Many Requests" });
    await expect(searchRecent("q", undefined, { bearerToken: "tok", fetchImpl })).rejects.toThrow(
      /429/,
    );
  });
});
