import type { RawPostMessage } from "../types";
import type { XSearchResponse, XTweet } from "./x-client.types";

// Turns a raw search/recent response into the normalized candidates the
// pipeline extracts GitHub links from. The one subtlety this encodes (per
// BRIEF.md §2 "Listen"): a repost's own tweet object carries no useful
// entities — its URLs live on the *original* tweet, reached via the
// referenced_tweets[type=retweeted] -> includes.tweets expansion. Quote
// tweets are left alone (their own commentary/links are what a quoting
// account actually said), only pure retweets are resolved to the original.
export function extractRawPosts(response: XSearchResponse): RawPostMessage[] {
  const tweets = response.data ?? [];
  if (tweets.length === 0) return [];

  const includedTweetsById = new Map((response.includes?.tweets ?? []).map((t) => [t.id, t]));
  const usersById = new Map((response.includes?.users ?? []).map((u) => [u.id, u]));

  const candidates: RawPostMessage[] = [];

  for (const tweet of tweets) {
    const entitiesSource = resolveEntitiesSource(tweet, includedTweetsById);
    const urls = (entitiesSource.entities?.urls ?? []).map((u) => u.expanded_url);
    if (urls.length === 0) continue;

    const authorUserId = tweet.author_id ?? "";
    const author = authorUserId ? usersById.get(authorUserId) : undefined;
    const authorHandle = author?.username ?? authorUserId;

    candidates.push({
      postId: tweet.id,
      postUrl: `https://x.com/${authorHandle || "i"}/status/${tweet.id}`,
      authorHandle,
      authorUserId,
      postedAt: tweet.created_at ?? "",
      urls,
    });
  }

  return candidates;
}

function resolveEntitiesSource(tweet: XTweet, includedTweetsById: Map<string, XTweet>): XTweet {
  const retweetRef = tweet.referenced_tweets?.find((rt) => rt.type === "retweeted");
  if (!retweetRef) return tweet;
  return includedTweetsById.get(retweetRef.id) ?? tweet;
}
