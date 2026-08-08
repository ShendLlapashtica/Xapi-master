import { base64ToText } from "../lib/base64";
import type { GithubCommit, GithubContentEntry, GithubReadme, GithubRepo } from "./github-client.types";

const API_BASE = "https://api.github.com";

export interface GithubClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
}

async function githubFetch(path: string, options: GithubClientOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "xapi-verification-pipeline",
  };
  // GITHUB_TOKEN is optional: an empty/missing token still works against
  // GitHub's public REST API, just at the unauthenticated 60 req/hour
  // limit instead of 5000/hour -- sending `Authorization: Bearer ` with an
  // empty value would get rejected outright, so omit the header entirely
  // rather than send a broken one.
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  return fetchImpl(`${API_BASE}${path}`, { headers });
}

// Sanity tier: repo existence + license + activity. Returns null on 404
// (a deleted/renamed repo is a sanity *failure*, not an infra error).
export async function getRepo(
  owner: string,
  repo: string,
  options: GithubClientOptions,
): Promise<GithubRepo | null> {
  const res = await githubFetch(`/repos/${owner}/${repo}`, options);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getRepo failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GithubRepo;
}

// Sanity tier: "some commit history beyond an initial commit" -- callers
// pass a small per_page (2 is enough to distinguish 0/1/2+ commits) rather
// than paginating the whole history.
export async function listCommits(
  owner: string,
  repo: string,
  options: GithubClientOptions,
  params: { sha?: string; perPage?: number } = {},
): Promise<GithubCommit[]> {
  const query = new URLSearchParams();
  if (params.sha) query.set("sha", params.sha);
  query.set("per_page", String(params.perPage ?? 2));
  const res = await githubFetch(`/repos/${owner}/${repo}/commits?${query}`, options);
  if (res.status === 404 || res.status === 409) return []; // 409 = empty repo, no commits yet
  if (!res.ok) throw new Error(`GitHub listCommits failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GithubCommit[];
}

// Classify tier: README, decoded to plain text. Null when the repo has no README.
export async function getReadmeText(
  owner: string,
  repo: string,
  options: GithubClientOptions,
): Promise<string | null> {
  const res = await githubFetch(`/repos/${owner}/${repo}/readme`, options);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getReadme failed: ${res.status} ${await res.text()}`);
  const readme = (await res.json()) as GithubReadme;
  if (readme.encoding !== "base64") return readme.content;
  return base64ToText(readme.content.replace(/\n/g, ""));
}

// Smoke tier: root file listing, feeds src/verify/stack-detect.ts.
export async function listRootContents(
  owner: string,
  repo: string,
  options: GithubClientOptions,
  ref?: string,
): Promise<GithubContentEntry[]> {
  return listContents(owner, repo, "", options, ref);
}

// Same, but for an arbitrary path -- used to probe one level into common
// monorepo container directories (packages/, libs/, ...) when nothing is
// found at the true root. Returns [] on 404 (path doesn't exist) rather
// than throwing, since "not found" is an expected outcome when probing.
export async function listContents(
  owner: string,
  repo: string,
  path: string,
  options: GithubClientOptions,
  ref?: string,
): Promise<GithubContentEntry[]> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(`/repos/${owner}/${repo}/contents/${path}${query}`, options);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listContents failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GithubContentEntry[];
}
