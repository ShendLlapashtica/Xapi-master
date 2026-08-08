// Partial shapes of the GitHub REST/Contents API responses this pipeline reads.

export interface GithubRepo {
  default_branch: string;
  license: { spdx_id: string | null } | null;
  html_url: string;
  full_name: string;
}

export interface GithubCommit {
  sha: string;
}

export interface GithubContentEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
}

export interface GithubReadme {
  content: string; // base64
  encoding: "base64" | string;
  path: string;
}
