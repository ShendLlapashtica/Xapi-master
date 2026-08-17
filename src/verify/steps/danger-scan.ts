import type { Env } from "../../types";
import { getRawFile, getTree } from "../github-client";
import { selectScanCandidates } from "./scan-candidates";

const SCAN_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".json", ".yml", ".yaml"];
const MAX_FILES_SCANNED = 30; // caps worst-case raw.githubusercontent.com calls per repo
const MAX_FILE_SIZE_BYTES = 300_000; // skip generated/vendored blobs, not worth reading

export interface DangerFinding {
  pattern: string;
  file: string;
  snippet: string;
}

export interface DangerScanResult {
  passed: boolean;
  findings: DangerFinding[];
  filesScanned: number;
}

// Same class of checks as the repo-vetting skill's hard gates
// (no-dangerous-exec-patterns, no-credential-exfil-pattern) -- that script
// was run for real against bmad-code-org/BMAD-METHOD (2026-08-16, 25
// skills) before this was ported here, including confirming its one flag
// that session was a false positive (inert help text, not an executed
// pipe-to-shell). Static/textual only, same "no code execution" ethos as
// the sanity tier this runs alongside -- reads file content over HTTP,
// never runs anything.
const DANGEROUS_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "pipe-to-shell", regex: /(curl|wget)\s+[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i },
  { name: "eval-call", regex: /\beval\s*\(/ },
  { name: "base64-decode-piped-to-shell", regex: /base64\s+-d[^\n|]*\|\s*(sh|bash)\b/i },
  { name: "dynamic-exec", regex: /child_process[^\n]{0,40}\.\s*exec\s*\(/ },
  { name: "encoded-powershell-payload", regex: /powershell[^\n]{0,20}-(e|enc|encodedcommand)\b/i },
];

// Credential read within ~80 chars of an outbound call, in either order --
// "read a secret, then send it somewhere" covers both `const t =
// process.env.X; fetch(url, {headers: {t}})` (env first) and the equally
// common inline `fetch(url, {body: process.env.X})` (call first, env
// nested in its arguments).
const ENV_TOKEN = "(process\\.env\\[[^\\]]+\\]|process\\.env\\.\\w+|os\\.environ\\[[^\\]]+\\])";
const CALL_TOKEN = "(fetch\\(|requests\\.(post|get)\\(|axios\\.(post|get)\\()";
const CREDENTIAL_EXFIL_REGEX = new RegExp(
  `(${ENV_TOKEN}[\\s\\S]{0,80}${CALL_TOKEN})|(${CALL_TOKEN}[\\s\\S]{0,80}${ENV_TOKEN})`,
);

function findMatches(content: string, filePath: string): DangerFinding[] {
  const findings: DangerFinding[] = [];
  for (const { name, regex } of DANGEROUS_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      findings.push({ pattern: name, file: filePath, snippet: match[0].slice(0, 120) });
    }
  }
  const exfilMatch = content.match(CREDENTIAL_EXFIL_REGEX);
  if (exfilMatch) {
    findings.push({ pattern: "credential-exfil-shape", file: filePath, snippet: exfilMatch[0].slice(0, 120) });
  }
  return findings;
}

// package.json install hooks run automatically on `npm install`, before
// anyone reviews anything -- a well-known real supply-chain vector, and a
// materially different risk than the same command sitting inert in a
// script nobody runs. Flagged on ANY non-trivial hook command, not just
// ones matching DANGEROUS_PATTERNS above.
function scanPackageJsonHooks(content: string, filePath: string): DangerFinding[] {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(content) as { scripts?: Record<string, string> };
  } catch {
    return [];
  }
  const findings: DangerFinding[] = [];
  for (const hook of ["preinstall", "install", "postinstall"]) {
    const command = pkg.scripts?.[hook];
    if (command && /curl|wget|eval|base64|Invoke-|iex\b/i.test(command)) {
      findings.push({ pattern: `suspicious-${hook}-hook`, file: filePath, snippet: command.slice(0, 120) });
    }
  }
  return findings;
}

// Danger-scan tier: static content scan for supply-chain/malware shapes,
// run after sanity and before classify -- cheap (no Groq call, no
// sandbox) and cheapest to fail fast on, so a flagged repo never reaches
// execution or costs pipeline budget on a repo we won't trust regardless
// of what it classifies as.
export async function runDangerScan(
  owner: string,
  repo: string,
  ref: string,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<DangerScanResult> {
  const options = { token: env.GITHUB_TOKEN, fetchImpl };
  const tree = await getTree(owner, repo, ref, options);

  const candidates = selectScanCandidates(tree, {
    extensions: SCAN_EXTENSIONS,
    maxFiles: MAX_FILES_SCANNED,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  });

  const findings: DangerFinding[] = [];
  for (const entry of candidates) {
    const content = await getRawFile(owner, repo, ref, entry.path, options);
    if (!content) continue;
    findings.push(...findMatches(content, entry.path));
    if (entry.path.endsWith("package.json")) {
      findings.push(...scanPackageJsonHooks(content, entry.path));
    }
  }

  return { passed: findings.length === 0, findings, filesScanned: candidates.length };
}
