import { base64ToText } from "../lib/base64";
import type { GithubCommit, GithubContentEntry, GithubReadme, GithubRepo, GithubTreeEntry } from "./github-client.types";

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

// Danger-scan tier: whole-repo file listing in one call, rather than
// walking directories one at a time like listContents -- recursive=1
// returns every blob's path + size, which is what a size-capped content
// scan needs to decide what's even worth reading.
export async function getTree(
  owner: string,
  repo: string,
  ref: string,
  options: GithubClientOptions,
): Promise<GithubTreeEntry[]> {
  const res = await githubFetch(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, options);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub getTree failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { tree?: GithubTreeEntry[] };
  return body.tree ?? [];
}

// Danger-scan tier: raw file text via raw.githubusercontent.com rather
// than the contents API -- a separate host with a separate rate limit, so
// scanning ~30 files per repo doesn't eat into the same api.github.com
// budget every other tier shares, and returns plain text directly instead
// of base64 needing a decode step.
//
// raw.githubusercontent.com is unauthenticated -- against a private repo it
// 404s even with a valid GITHUB_TOKEN, because the token never reaches that
// host. When that happens and a token *is* available, fall back to the
// authenticated Contents API (same {content, encoding} shape as
// getReadmeText's response, decoded the same way) so a private repo isn't
// silently treated as "nothing to scan." No token -> identical behavior to
// before: one unauthenticated request, null on any failure.
export async function getRawFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  options: GithubClientOptions & { fetchImpl?: typeof fetch },
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
  );
  if (res.ok) return res.text();
  if (!options.token) return null;

  const apiRes = await githubFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, options);
  if (!apiRes.ok) return null;
  const body = (await apiRes.json()) as GithubReadme; // same {content, encoding, path} shape
  if (body.encoding !== "base64") return body.content;
  return base64ToText(body.content.replace(/\n/g, ""));
}
