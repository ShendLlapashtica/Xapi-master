// Mirrors relay/src/types.ts by hand -- see that file's comment for why
// there's no shared package between the Worker and the relay.

export type Stack = "node" | "python" | "go" | "rust";

export interface RunStepRequest {
  name: string;
  command: string;
  timeoutMs: number;
}

export interface RunInputFile {
  path: string;
  contentBase64: string;
}

export interface RunRequest {
  template: Stack;
  repoUrl: string;
  commitSha: string;
  // Subdirectory (relative to the repo root, no leading/trailing slash)
  // where the manifest actually lives -- null for a normal repo, set for
  // monorepos (see src/verify/steps/smoke.ts's detectStackForRepo). Steps
  // run with this as their working directory instead of the clone root.
  packageDir: string | null;
  egressAllowlist: string[];
  resourceLimits: { cpuCount: number; memoryMb: number; timeoutMs: number };
  steps: RunStepRequest[];
  inputFiles?: RunInputFile[];
  outputFile?: string;
}

export interface RunStepResult {
  name: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  skipped: boolean;
}

export interface RunResponse {
  sandboxId: string;
  steps: RunStepResult[];
  outputFile: { path: string; contentBase64: string } | null;
}
