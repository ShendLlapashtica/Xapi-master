// Wire contract between the Worker (Workflow steps) and this relay. Kept in
// sync by hand with src/sandbox/e2b-client.types.ts on the Worker side --
// they're genuinely two separate deployables (Worker can't import Node code,
// this relay can't run in a V8 isolate), so there's no shared package here.

export type Stack = "node" | "python" | "go" | "rust";

export interface RunStepRequest {
  name: string;
  command: string; // run via `sh -c`
  timeoutMs: number;
}

export interface RunInputFile {
  path: string; // path relative to the sandbox's working directory
  contentBase64: string;
}

export interface RunRequest {
  template: Stack;
  repoUrl: string;
  commitSha: string;
  // Subdirectory (relative to the repo root) where the manifest actually
  // lives -- null for a normal repo, set for monorepos. Steps run with
  // this as their working directory instead of the clone root.
  packageDir: string | null;
  egressAllowlist: string[]; // hostnames; this relay resolves them to CIDRs
  resourceLimits: { cpuCount: number; memoryMb: number; timeoutMs: number };
  steps: RunStepRequest[];
  inputFiles?: RunInputFile[];
  // After all steps run, read this file's content from the sandbox (relative
  // to the working directory) and return it. Used when a tool's CLI
  // invocation writes to a file rather than stdout.
  outputFile?: string;
}

export interface RunStepResult {
  name: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  skipped: boolean; // true when a prior step failed and this one never ran
}

export interface RunResponse {
  sandboxId: string;
  steps: RunStepResult[];
  outputFile: { path: string; contentBase64: string } | null;
}
