import type { GithubTreeEntry } from "../github-client.types";

// Shared by danger-scan.ts and secrets-scan.ts: both walk the same repo
// tree looking for text files worth reading, just with different pattern
// sets once a file is fetched. Factored out so the two steps can't drift
// on what counts as "worth scanning."
export interface ScanCandidateOptions {
  extensions: string[];
  maxFiles: number;
  maxFileSizeBytes: number;
}

export function selectScanCandidates(
  tree: GithubTreeEntry[],
  options: ScanCandidateOptions,
): GithubTreeEntry[] {
  return tree
    .filter((e) => e.type === "blob")
    .filter((e) => options.extensions.some((ext) => e.path.endsWith(ext)))
    .filter((e) => (e.size ?? 0) <= options.maxFileSizeBytes)
    .slice(0, options.maxFiles);
}
