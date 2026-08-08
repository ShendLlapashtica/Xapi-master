// Canonicalizes a URL found in a post's entities into a GitHub repo identity,
// or returns null if it isn't one. Scope is deliberately narrow for the PoC:
// only github.com/{owner}/{repo}[...] is recognized. raw.githubusercontent.com,
// gist.github.com, and GitHub's own non-repo top-level paths (settings,
// marketplace, ...) are explicitly out of scope, not silently mis-parsed.

export interface CanonicalGithubRepo {
  owner: string;
  repo: string;
  subpath: string | null; // e.g. "tree/main/packages/foo" for a monorepo link
  canonicalUrl: string; // https://github.com/{owner}/{repo}
}

// GitHub top-level paths that look like "owner" but aren't a user/org.
const RESERVED_OWNER_PATHS = new Set([
  "about",
  "apps",
  "codespaces",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "team",
  "topics",
  "trending",
]);

const OWNER_REPO_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function canonicalizeGithubUrl(rawUrl: string): CanonicalGithubRepo | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const [ownerRaw, repoRaw, ...rest] = segments;
  if (!ownerRaw || !repoRaw) return null;
  if (RESERVED_OWNER_PATHS.has(ownerRaw.toLowerCase())) {
    return null;
  }
  if (!OWNER_REPO_SEGMENT.test(ownerRaw) || !OWNER_REPO_SEGMENT.test(repoRaw)) {
    return null;
  }

  const owner = ownerRaw;
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!repo) return null;

  const subpath = rest.length > 0 ? rest.join("/") : null;

  return {
    owner,
    repo,
    subpath,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}
