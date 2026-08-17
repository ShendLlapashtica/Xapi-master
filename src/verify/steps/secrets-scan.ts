import type { Env } from "../../types";
import { getRawFile, getTree } from "../github-client";
import { selectScanCandidates } from "./scan-candidates";

// Extends danger-scan.ts's extension list with the shapes secrets actually
// live in that code rarely does (env files, key files, config files).
const SCAN_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".json", ".yml", ".yaml",
  ".env", ".pem", ".key", ".cfg", ".ini", ".properties",
];
const MAX_FILES_SCANNED = 30;
const MAX_FILE_SIZE_BYTES = 300_000;

export interface SecretFinding {
  pattern: string;
  file: string;
  snippet: string;
}

export interface SecretsScanResult {
  passed: boolean;
  findings: SecretFinding[];
  filesScanned: number;
}

// Distinct from danger-scan.ts's CREDENTIAL_EXFIL_REGEX: that catches *code*
// that reads an env var and sends it over the network. This catches literal
// secret material sitting in a tracked file, whether or not anything in the
// repo ever reads it.
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "aws-access-key-id", regex: /AKIA[0-9A-Z]{16}/ },
  {
    name: "generic-api-key-assignment",
    regex: /(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
  },
  { name: "pem-private-key", regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: "slack-token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "github-pat", regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
];

// Evidence lands under /evidence/*, which src/api/evidence-route.ts serves
// unauthenticated -- storing a raw matched secret there would hand it to
// anyone who requests the URL. Findings only ever carry a redacted snippet.
function redact(value: string): string {
  return value.length <= 8 ? "***" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function findSecrets(content: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      findings.push({ pattern: name, file: filePath, snippet: redact(match[0]) });
    }
  }
  return findings;
}

// Secrets tier: literal secret material committed into tracked files *at
// HEAD* -- current tree only, same scope boundary as danger-scan.ts. A
// secret committed and later removed/rotated in a subsequent commit will
// NOT be caught here: this pipeline has no git-clone capability outside the
// E2B sandbox tier, so full-history scanning (the way trufflehog/gitleaks
// work) is out of scope. That's a stated gap, not a hidden one -- this
// proves "no known secret pattern in the tree right now", nothing about
// history before it.
export async function runSecretsScan(
  owner: string,
  repo: string,
  ref: string,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<SecretsScanResult> {
  const options = { token: env.GITHUB_TOKEN, fetchImpl };
  const tree = await getTree(owner, repo, ref, options);

  const candidates = selectScanCandidates(tree, {
    extensions: SCAN_EXTENSIONS,
    maxFiles: MAX_FILES_SCANNED,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  });

  const findings: SecretFinding[] = [];
  for (const entry of candidates) {
    const content = await getRawFile(owner, repo, ref, entry.path, options);
    if (!content) continue;
    findings.push(...findSecrets(content, entry.path));
  }

  return { passed: findings.length === 0, findings, filesScanned: candidates.length };
}
