import type { Stack } from "../types";

// Computes the sandbox's egress allowlist: the repo's own remote, plus the
// hosts its detected stack's package registry actually needs. Per
// BRIEF.md's security model this is "the repo's own git remote plus the ONE
// package registry its detected stack needs -- nothing else" -- in practice
// a couple of registries (PyPI, crates.io) split their index and artifact
// hosts, so "one registry" means one *registry product*, not literally one
// hostname. This list is what src/sandbox/templates/*/e2b.Dockerfile's
// startup script turns into iptables/nft DROP rules for everything else.
const REGISTRY_HOSTS: Record<Stack, string[]> = {
  node: ["registry.npmjs.org"],
  python: ["pypi.org", "files.pythonhosted.org"],
  go: ["proxy.golang.org", "sum.golang.org"],
  rust: ["crates.io", "static.crates.io", "index.crates.io"],
};

export function computeEgressAllowlist(stack: Stack, repoRemoteHost: string): string[] {
  const hosts = new Set<string>([repoRemoteHost, ...REGISTRY_HOSTS[stack]]);
  return [...hosts];
}
