// rettiwt-api's TweetFilter takes structured fields (fromUsers: string[]),
// not a compound query string like the official v2 API this replaced --
// so there's no query-string builder left here, just handle normalization.
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}
