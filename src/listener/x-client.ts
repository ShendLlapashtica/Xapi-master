import type { XSearchResponse } from "./x-client.types";

const SEARCH_RECENT_URL = "https://api.x.com/2/tweets/search/recent";

export interface XClientOptions {
  bearerToken: string;
  fetchImpl?: typeof fetch;
}

// GET /2/tweets/search/recent for the whole roster in one call, with the
// expansions needed to resolve retweet URLs (see x-parse.ts) and a
// since_id cursor so a quiet poll costs nothing. Injectable fetch keeps
// this testable without a live X_BEARER_TOKEN.
export async function searchRecent(
  query: string,
  sinceId: string | undefined,
  options: XClientOptions,
): Promise<XSearchResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(SEARCH_RECENT_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("expansions", "referenced_tweets.id,author_id");
  url.searchParams.set("tweet.fields", "entities,created_at");
  url.searchParams.set("max_results", "100");
  if (sinceId) {
    url.searchParams.set("since_id", sinceId);
  }

  const res = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${options.bearerToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X search/recent failed: ${res.status} ${text}`);
  }

  return (await res.json()) as XSearchResponse;
}
