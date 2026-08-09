import type { RawPostMessage } from "../types";

// Deliberately narrower than rettiwt-api's full `Tweet` class -- only the
// fields this mapping actually reads, so tests can pass plain object
// fixtures instead of constructing real class instances (Tweet has ~15
// required fields unrelated to this logic). A real `Tweet` satisfies this
// structurally with no cast needed at the call site in x-client.ts.
export interface MinimalTweet {
  id: string;
  createdAt?: string;
  tweetBy?: { userName?: string; id?: string };
  entities?: { urls?: string[] };
  retweetedTweet?: MinimalTweet;
}

// A repost's own tweet object carries no useful entities of its own -- its
// urls live on the *original* tweet, which rettiwt-api already resolves
// and nests at `retweetedTweet` (no separate expansion/includes lookup
// needed, unlike the official v2 API this replaces). Quote tweets are left
// alone: `tweet.entities` on a quote tweet is the quoting account's own
// commentary/links, which is what should be extracted -- not the quoted
// tweet's, mirroring the official-API design's same distinction.
export function tweetToRawPosts(tweet: MinimalTweet): RawPostMessage[] {
  const source = tweet.retweetedTweet ?? tweet;
  const urls = source.entities?.urls ?? [];
  if (urls.length === 0) return [];

  return [
    {
      postId: tweet.id,
      postUrl: `https://x.com/${tweet.tweetBy?.userName || "i"}/status/${tweet.id}`,
      authorHandle: tweet.tweetBy?.userName ?? "",
      authorUserId: tweet.tweetBy?.id ?? "",
      postedAt: tweet.createdAt ?? "",
      urls,
    },
  ];
}
