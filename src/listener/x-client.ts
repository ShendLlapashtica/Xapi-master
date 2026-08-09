import { Rettiwt, TweetFilter } from "rettiwt-api";
import { tweetToRawPosts } from "./x-parse";
import type { RawPostMessage } from "../types";

// The self-hosted X client -- talks to X's own internal API the way the
// website itself does, authenticated as a dedicated secondary account's
// logged-in session, instead of the paid official developer API (declined,
// see README.md's "X integration"). Verified 2026-08-09: rettiwt-api@4.2.0
// bundles cleanly for a Workers `nodejs_compat` build (see
// x-client.workers-bundle.test.ts) -- the earlier candidate,
// `agent-twitter-client`, does not (pulls in a native WebRTC binding that
// crashes on import outside Node). rettiwt-api's own transitive deps
// (axios, form-data) had real, current CVEs at install time -- pinned to
// patched versions via package.json's `overrides`, not left to chance,
// since this client carries a real account's session token.
//
// `sessionToken` is rettiwt-api's `apiKey` config value -- despite the
// name, it's an *encoded cookie string* (auth_token/ct0/twid from a real
// logged-in browser session), produced by `AuthService.encodeCookie()`,
// not anything purchased. See README.md for exactly how to get one.
export function createXClient(sessionToken?: string): Rettiwt {
  return sessionToken ? new Rettiwt({ apiKey: sessionToken }) : new Rettiwt();
}

// The slice of Rettiwt's surface pollAccounts actually needs -- narrowed so
// tests can inject a fake without constructing a real Rettiwt instance
// (which requires a valid-shaped session token even in guest mode's error
// paths).
export interface XPollClient {
  tweet: Pick<Rettiwt["tweet"], "search">;
}

export interface PollResult {
  messages: RawPostMessage[];
  newestId: string | undefined;
}

// One search covering the whole tracked roster, mirroring BRIEF.md's "one
// call covers the whole roster" design. `links: true` server-side
// prefilters to posts containing at least one URL; `replies: false`
// matches the official-API design's `-is:reply`. `sinceId` keeps a quiet
// poll cheap and idempotent the same way the official API's cursor did.
export async function pollAccounts(
  client: XPollClient,
  handles: string[],
  sinceId: string | undefined,
): Promise<PollResult> {
  if (handles.length === 0) {
    return { messages: [], newestId: sinceId };
  }

  const filter = new TweetFilter({ fromUsers: handles, sinceId, replies: false, links: true });
  const page = await client.tweet.search(filter, 20);

  const messages: RawPostMessage[] = [];
  let newestId = sinceId;

  for (const tweet of page.list) {
    messages.push(...tweetToRawPosts(tweet));
    if (!newestId || BigInt(tweet.id) > BigInt(newestId)) {
      newestId = tweet.id;
    }
  }

  return { messages, newestId };
}
