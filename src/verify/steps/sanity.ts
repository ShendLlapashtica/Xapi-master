import { getReadmeText, getRepo, listCommits } from "../github-client";
import type { Env } from "../../types";

const MIN_README_LENGTH = 200; // chars; a placeholder-scaffold README is shorter than this

export interface SanityResult {
  passed: boolean;
  reason: string | null;
  defaultBranch: string | null;
  headSha: string | null;
}

// Sanity tier (BRIEF.md §2): repo exists, isn't an empty scaffold, has some
// commit history beyond an initial commit, has a license or a substantive
// README. No code execution -- GitHub REST API only.
export async function runSanityCheck(
  owner: string,
  repo: string,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<SanityResult> {
  const options = { token: env.GITHUB_TOKEN, fetchImpl };

  const repoMeta = await getRepo(owner, repo, options);
  if (!repoMeta) {
    return { passed: false, reason: "repository not found", defaultBranch: null, headSha: null };
  }

  const hasLicense = repoMeta.license !== null;
  const readmeText = await getReadmeText(owner, repo, options);
  const hasSubstantiveReadme = (readmeText?.trim().length ?? 0) >= MIN_README_LENGTH;

  if (!hasLicense && !hasSubstantiveReadme) {
    return {
      passed: false,
      reason: "no license and no substantive README",
      defaultBranch: repoMeta.default_branch,
      headSha: null,
    };
  }

  const commits = await listCommits(owner, repo, options, {
    sha: repoMeta.default_branch,
    perPage: 2,
  });
  const headSha = commits[0]?.sha ?? null;

  if (commits.length < 2) {
    return {
      passed: false,
      reason: "no commit history beyond an initial commit",
      defaultBranch: repoMeta.default_branch,
      headSha,
    };
  }

  return { passed: true, reason: null, defaultBranch: repoMeta.default_branch, headSha };
}
