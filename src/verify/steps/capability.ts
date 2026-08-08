import fixturesManifest from "../../../seed/fixtures.manifest.json";
import { base64ToText, bytesToBase64 } from "../../lib/base64";
import { runInSandbox } from "../../sandbox/e2b-client";
import { computeEgressAllowlist } from "../../sandbox/egress-policy";
import type { CliInvocation, Env, FixtureExpectedProfile, FixtureId, FixtureResult, Stack } from "../../types";
import { renderCliCommand, renderOutputPath } from "../cli-invocation";
import { classifyFixtureOutcome } from "../fixture-outcome";

export const FIXTURES = fixturesManifest as FixtureExpectedProfile[];

const CAPABILITY_TIMEOUT_MS = 3 * 60_000; // per-fixture budget, tighter than smoke's 5 min

// See src/verify/steps/smoke.ts for why this is explicit if/elif/else
// rather than a chained &&/|| one-liner, and why the python branch tries
// the "all" extra first.
const INSTALL_COMMANDS: Record<Stack, string> = {
  node: "if [ -f package-lock.json ]; then npm ci; else npm install; fi",
  python:
    "if [ -f pyproject.toml ] || [ -f setup.py ]; then pip install '.[all]' || pip install .; elif [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f Pipfile ]; then pip install pipenv && pipenv install --system --skip-lock; else echo 'no known python manifest' >&2 && exit 1; fi",
  go: "go build ./...",
  rust: "cargo build --release",
};

export interface CapabilityFixtureInput {
  owner: string;
  repo: string;
  commitSha: string;
  stack: Stack;
  packageDir: string | null;
  cliInvocation: CliInvocation;
}

// Runs one capability-tier fixture in its own fresh E2B sandbox (BRIEF.md
// §2: "one fresh sandbox per capability fixture"). The fixture's exact
// command, exit code, stdout/stderr, and any output file are all that's
// needed for the caller to persist evidence -- this function only runs and
// scores, it doesn't write to R2/D1 (that's the workflow's
// capability-verdict-persist step, matching the file-per-thing evidence
// layout in src/catalog/evidence-store.ts).
export async function runCapabilityFixture(
  fixture: FixtureExpectedProfile,
  input: CapabilityFixtureInput,
  env: Env,
): Promise<FixtureResult & { stdout: string; stderr: string }> {
  const fixtureObject = await env.EVIDENCE.get(`fixtures/${fixture.file}`);
  if (!fixtureObject) {
    return invocationErrorResult(
      fixture,
      "",
      `fixture asset fixtures/${fixture.file} missing from R2 -- see fixtures/README.md`,
    );
  }

  const inputBytes = new Uint8Array(await fixtureObject.arrayBuffer());
  // Trust the command's literal content over the model's separate
  // outputMode field when they disagree -- confirmed live: a classified
  // invocation had outputMode "stdout" but the command itself contained a
  // `> {output}` redirect, and substituting {output} with "" (the
  // stdout-mode default) produced a broken, dangling shell redirect. If
  // {output} appears anywhere in the command, it needs a real path
  // regardless of what outputMode claims.
  const needsOutputPath = input.cliInvocation.command.includes("{output}");
  const outputFile = needsOutputPath
    ? renderOutputPath(input.cliInvocation.outputPathTemplate ?? "{basename}.out", fixture.file)
    : undefined;
  const command = renderCliCommand(input.cliInvocation.command, {
    input: fixture.file,
    output: outputFile ?? "",
  });

  const response = await runInSandbox(
    {
      template: input.stack,
      repoUrl: `https://github.com/${input.owner}/${input.repo}`,
      commitSha: input.commitSha,
      packageDir: input.packageDir,
      egressAllowlist: computeEgressAllowlist(input.stack, "github.com"),
      resourceLimits: { cpuCount: 2, memoryMb: 2048, timeoutMs: CAPABILITY_TIMEOUT_MS },
      steps: [
        { name: "install", command: INSTALL_COMMANDS[input.stack], timeoutMs: CAPABILITY_TIMEOUT_MS },
        { name: "run-tool", command, timeoutMs: CAPABILITY_TIMEOUT_MS },
      ],
      inputFiles: [{ path: fixture.file, contentBase64: bytesToBase64(inputBytes) }],
      outputFile,
    },
    env,
  );

  const runToolStep = response.steps.find((s) => s.name === "run-tool");
  const outputText =
    needsOutputPath
      ? response.outputFile
        ? base64ToText(response.outputFile.contentBase64)
        : null
      : (runToolStep?.stdout ?? null);

  const scored = classifyFixtureOutcome(
    {
      exitCode: runToolStep?.exitCode ?? null,
      stderr: runToolStep?.stderr ?? "",
      outputText,
    },
    fixture,
  );

  return {
    fixtureId: fixture.fixtureId,
    outcome: scored.outcome,
    exitCode: runToolStep?.exitCode ?? null,
    command,
    wordCount: scored.wordCount,
    detectedStructures: scored.detectedStructures,
    evidenceKey: "", // filled in by the persist step, which knows the componentId
    durationMs: runToolStep?.durationMs ?? 0,
    stdout: runToolStep?.stdout ?? "",
    stderr: runToolStep?.stderr ?? "",
  };
}

function invocationErrorResult(
  fixture: FixtureExpectedProfile,
  command: string,
  reason: string,
): FixtureResult & { stdout: string; stderr: string } {
  return {
    fixtureId: fixture.fixtureId,
    outcome: "invocation_error",
    exitCode: null,
    command,
    wordCount: null,
    detectedStructures: [],
    evidenceKey: "",
    durationMs: 0,
    stdout: "",
    stderr: reason,
  };
}

export function fixtureIds(): FixtureId[] {
  return FIXTURES.map((f) => f.fixtureId);
}
