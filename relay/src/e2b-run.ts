import { CommandExitError, Sandbox, TimeoutError } from "e2b";
import type { RunInputFile, RunRequest, RunResponse, RunStepRequest, RunStepResult } from "./types.js";

const WORKDIR = "/home/user/repo";
const CLONE_TIMEOUT_MS = 60_000;

// Custom per-stack templates (../../src/sandbox/templates/*/e2b.Dockerfile)
// need `e2b template build`, a one-time step gated on Docker being
// available (see that directory's README.md) -- still not done. In the
// meantime, E2B's stock "base" template already ships Python 3.11 + pip
// and Node 20 + npm (verified live), so those two stacks work today with
// no custom build. Go and Rust have no runtime on "base" and stay mapped
// to their not-yet-built custom template names until that step happens.
const E2B_TEMPLATE_NAMES: Record<RunRequest["template"], string> = {
  node: "base",
  python: "base",
  go: "go",
  rust: "rust",
};

// Runs one verification tier's worth of shell steps inside a single,
// freshly-created E2B microVM, then unconditionally destroys it. This is
// the piece that has to live off the Cloudflare Worker: envd (the
// in-sandbox command daemon) speaks gRPC, and Workers' fetch can't do the
// bidirectional streaming that requires -- see relay/README.md. Everything
// else in the pipeline is a plain Worker; this relay's only job is being
// the one hop that can hold a real Node gRPC client.
export async function runInSandbox(req: RunRequest, apiKey: string): Promise<RunResponse> {
  const sbx = await Sandbox.create(E2B_TEMPLATE_NAMES[req.template], {
    apiKey,
    timeoutMs: req.resourceLimits.timeoutMs,
    // Egress allowlist enforced by the platform itself (SandboxNetworkOpts.allowOut
    // accepts plain hostnames) -- computed by src/sandbox/egress-policy.ts on the
    // Worker side and passed through verbatim. E2B requires an explicit
    // denyOut: ['0.0.0.0/0'] alongside allowOut or the request is rejected
    // outright -- confirmed live, and confirmed the allowlist is for real:
    // a sandbox created this way could reach an allowlisted host (200) but
    // not a non-allowlisted one (connection actively blocked, not just
    // slow/absent).
    network: { allowOut: req.egressAllowlist, denyOut: ["0.0.0.0/0"] },
    metadata: { purpose: "xapi-verification" },
  });

  // Monorepos put the actual package (and thus where install/run commands
  // need to execute) below the clone root -- see src/verify/steps/smoke.ts.
  const packageCwd = req.packageDir ? `${WORKDIR}/${req.packageDir}` : WORKDIR;

  try {
    const steps: RunStepResult[] = [];
    let failed = false;

    const cloneStep = await runStep(
      sbx,
      {
        name: "git-clone",
        command: `git clone ${shQuote(req.repoUrl)} ${WORKDIR} && cd ${WORKDIR} && git checkout ${shQuote(req.commitSha)}`,
        timeoutMs: CLONE_TIMEOUT_MS,
      },
      undefined,
    );
    steps.push(cloneStep);
    failed = cloneStep.exitCode !== 0;

    if (!failed && req.inputFiles) {
      failed = !(await writeInputFiles(sbx, packageCwd, req.inputFiles));
    }

    for (const step of req.steps) {
      if (failed) {
        steps.push(skippedResult(step));
        continue;
      }
      const result = await runStep(sbx, step, packageCwd);
      steps.push(result);
      if (result.exitCode !== 0) failed = true;
    }

    const outputFile = await readOutputFile(sbx, packageCwd, req, failed);

    return { sandboxId: sbx.sandboxId, steps, outputFile };
  } finally {
    await sbx.kill().catch((err: unknown) => {
      console.error(`failed to kill sandbox ${sbx.sandboxId}`, err);
    });
  }
}

async function writeInputFiles(sbx: Sandbox, cwd: string, files: RunInputFile[]): Promise<boolean> {
  try {
    for (const file of files) {
      const bytes = Buffer.from(file.contentBase64, "base64");
      await sbx.files.write(`${cwd}/${file.path}`, new Blob([bytes]));
    }
    return true;
  } catch (err) {
    console.error("failed to write input files", err);
    return false;
  }
}

async function readOutputFile(
  sbx: Sandbox,
  cwd: string,
  req: RunRequest,
  failed: boolean,
): Promise<RunResponse["outputFile"]> {
  if (!req.outputFile || failed) return null;
  try {
    const bytes = await sbx.files.read(`${cwd}/${req.outputFile}`, { format: "bytes" });
    return { path: req.outputFile, contentBase64: Buffer.from(bytes).toString("base64") };
  } catch {
    // Output file was never written -- the scoring logic on the Worker side
    // treats a missing outputFile the same as empty output, not an error.
    return null;
  }
}

function skippedResult(step: RunStepRequest): RunStepResult {
  return {
    name: step.name,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    skipped: true,
  };
}

async function runStep(
  sbx: Sandbox,
  step: RunStepRequest,
  cwd: string | undefined,
): Promise<RunStepResult> {
  const start = Date.now();
  try {
    const result = await sbx.commands.run(step.command, { cwd, timeoutMs: step.timeoutMs });
    return {
      name: step.name,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - start,
      timedOut: false,
      skipped: false,
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return {
        name: step.name,
        exitCode: err.exitCode,
        stdout: err.stdout,
        stderr: err.stderr,
        durationMs: Date.now() - start,
        timedOut: false,
        skipped: false,
      };
    }
    if (err instanceof TimeoutError) {
      return {
        name: step.name,
        exitCode: null,
        stdout: "",
        stderr: err.message,
        durationMs: Date.now() - start,
        timedOut: true,
        skipped: false,
      };
    }
    throw err;
  }
}

// POSIX single-quote escaping for values (repo URL, commit SHA) interpolated
// into shell commands run via `sh -c`. Both come from the catalog (already
// validated as a github.com URL / GitHub API commit sha), but quoting them
// defensively costs nothing.
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
