import { runInSandbox } from "../../sandbox/e2b-client";
import { computeEgressAllowlist } from "../../sandbox/egress-policy";
import type { Env, Stack, StackDetection } from "../../types";
import { listContents, listRootContents } from "../github-client";
import { detectStack } from "../stack-detect";

const SMOKE_TIMEOUT_MS = 5 * 60_000; // 5-minute budget, per BRIEF.md §2

// Explicit if/elif/else rather than chained &&/|| -- a left-to-right
// `A || B || C && D` chain does not group the way it reads (confirmed
// live: it fell through to `pip install -r requirements.txt` on a repo
// that has no requirements.txt at all, rather than skipping that branch).
// Python packages commonly gate heavy/optional dependencies (PDF parsing,
// OCR, ...) behind an "all"/"pdf" extra rather than shipping them in the
// bare install -- confirmed live against two real tools (docling,
// markitdown), both of which are unusable for their advertised purpose
// without it, and both of whose own READMEs recommend `pip install
// 'pkg[all]'` as the normal way to install. Trying that first, falling
// back to a bare install when no such extra is defined, mirrors what a
// real evaluator reading the README would actually run -- it is not
// specific to either tool.
const INSTALL_COMMANDS: Record<Stack, string> = {
  node: "if [ -f package-lock.json ]; then npm ci; else npm install; fi && (npm run build --if-present || true)",
  python:
    "if [ -f pyproject.toml ] || [ -f setup.py ]; then pip install '.[all]' || pip install .; elif [ -f requirements.txt ]; then pip install -r requirements.txt; else echo 'no known python manifest' >&2 && exit 1; fi",
  go: "go build ./...",
  rust: "cargo build --release",
};

// Common monorepo container directory conventions -- checked, in order,
// only when nothing is found at the true repo root. Real repos this
// unblocks: langchain-ai/langchain (libs/langchain/pyproject.toml),
// several monorepos that use packages/<name>.
const MONOREPO_CONTAINER_DIRS = ["packages", "libs", "lib", "python", "py", "src"];

export interface StackDetectionResult {
  stack: StackDetection;
  // Path (relative to repo root, no leading/trailing slash) where the
  // manifest was actually found, or null when it's at the true root.
  packageDir: string | null;
}

export async function detectStackForRepo(
  owner: string,
  repo: string,
  ref: string,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<StackDetectionResult> {
  const options = { token: env.GITHUB_TOKEN, fetchImpl };

  const rootEntries = await listRootContents(owner, repo, options, ref);
  const rootStack = detectStack(rootEntries.filter((e) => e.type === "file").map((e) => e.name));
  if (rootStack !== "unsupported") {
    return { stack: rootStack, packageDir: null };
  }

  const rootDirNames = new Set(rootEntries.filter((e) => e.type === "dir").map((e) => e.name));
  for (const containerDir of MONOREPO_CONTAINER_DIRS) {
    if (!rootDirNames.has(containerDir)) continue;

    const containerEntries = await listContents(owner, repo, containerDir, options, ref);

    // The manifest could be directly in the container dir itself...
    const containerStack = detectStack(
      containerEntries.filter((e) => e.type === "file").map((e) => e.name),
    );
    if (containerStack !== "unsupported") {
      return { stack: containerStack, packageDir: containerDir };
    }

    // ...or one level deeper, in a subdirectory named after the repo
    // (langchain-ai/langchain -> libs/langchain) -- the one unambiguous
    // guess. Anything less specific than "matches the repo name" is left
    // alone rather than guessed at.
    const hasRepoNamedSubdir = containerEntries.some((e) => e.type === "dir" && e.name === repo);
    if (hasRepoNamedSubdir) {
      const path = `${containerDir}/${repo}`;
      const deepEntries = await listContents(owner, repo, path, options, ref);
      const deepStack = detectStack(deepEntries.filter((e) => e.type === "file").map((e) => e.name));
      if (deepStack !== "unsupported") {
        return { stack: deepStack, packageDir: path };
      }
    }
  }

  return { stack: "unsupported", packageDir: null };
}

export interface SmokeRunResult {
  passed: boolean;
  sandboxId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// Smoke tier (BRIEF.md §2): clone the pinned commit SHA into a fresh E2B
// microVM, install/build, must exit 0 within budget.
export async function runSmoke(
  params: { owner: string; repo: string; commitSha: string; stack: Stack; packageDir: string | null },
  env: Env,
): Promise<SmokeRunResult> {
  const repoUrl = `https://github.com/${params.owner}/${params.repo}`;
  const response = await runInSandbox(
    {
      template: params.stack,
      repoUrl,
      commitSha: params.commitSha,
      packageDir: params.packageDir,
      egressAllowlist: computeEgressAllowlist(params.stack, "github.com"),
      resourceLimits: { cpuCount: 2, memoryMb: 2048, timeoutMs: SMOKE_TIMEOUT_MS },
      steps: [{ name: "install-build", command: INSTALL_COMMANDS[params.stack], timeoutMs: SMOKE_TIMEOUT_MS }],
    },
    env,
  );

  const cloneStep = response.steps.find((s) => s.name === "git-clone");
  const buildStep = response.steps.find((s) => s.name === "install-build");
  const failingStep = cloneStep?.exitCode !== 0 ? cloneStep : buildStep;

  return {
    passed: cloneStep?.exitCode === 0 && buildStep?.exitCode === 0,
    sandboxId: response.sandboxId,
    exitCode: failingStep?.exitCode ?? null,
    stdout: failingStep?.stdout ?? "",
    stderr: failingStep?.stderr ?? "",
    durationMs: (cloneStep?.durationMs ?? 0) + (buildStep?.durationMs ?? 0),
    timedOut: Boolean(cloneStep?.timedOut || buildStep?.timedOut),
  };
}
