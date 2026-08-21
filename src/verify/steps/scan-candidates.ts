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

// Test/spec/fixture files legitimately contain the exact byte shapes
// danger-scan.ts and secrets-scan.ts look for -- a detector's own test
// suite asserts on strings like `curl x | bash`, and a repo that documents
// or tests these patterns is a different thing from a repo that runs them.
// Reproduced concretely: the sibling repo-vetting skill's static scan,
// pointed at this repo, flagged Xapi's own DANGEROUS_PATTERNS regexes and
// their test fixtures as if they were live dangerous code. Excluded here,
// not per-caller, so danger-scan and secrets-scan can't drift on the rule.
const EXCLUDE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /(^|\/)fixtures?\//,
  /\.(test|spec)\.[^/.]+$/,
];

export function selectScanCandidates(
  tree: GithubTreeEntry[],
  options: ScanCandidateOptions,
): GithubTreeEntry[] {
  return tree
    .filter((e) => e.type === "blob")
    .filter((e) => options.extensions.some((ext) => e.path.endsWith(ext)))
    .filter((e) => (e.size ?? 0) <= options.maxFileSizeBytes)
    .filter((e) => !EXCLUDE_PATH_PATTERNS.some((pattern) => pattern.test(e.path)))
    .slice(0, options.maxFiles);
}
