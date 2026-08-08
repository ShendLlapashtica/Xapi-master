import type { StackDetection } from "../types";

// Root-file -> stack detection, per BRIEF.md's smoke tier ("node / python /
// go / rust, chosen from package.json/pyproject.toml/go.mod/Cargo.toml").
// Checked in a fixed priority order so a repo with more than one manifest
// (e.g. a Python tool with a package.json for docs tooling) still resolves
// deterministically.
const DETECTORS: Array<{ stack: Exclude<StackDetection, "unsupported">; files: string[] }> = [
  { stack: "node", files: ["package.json"] },
  { stack: "python", files: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"] },
  { stack: "go", files: ["go.mod"] },
  { stack: "rust", files: ["Cargo.toml"] },
];

export function detectStack(rootFiles: string[]): StackDetection {
  const present = new Set(rootFiles);
  for (const detector of DETECTORS) {
    if (detector.files.some((f) => present.has(f))) {
      return detector.stack;
    }
  }
  return "unsupported";
}
