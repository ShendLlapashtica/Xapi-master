// Interactive helper: paste X cookies from DevTools or Cookie-Editor, encode + deploy.
//
// Usage: npm run setup:x-session

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { AuthService } = require("rettiwt-api") as {
  AuthService: { encodeCookie: (cookie: string) => string };
};

const WORKER_URL = process.env.WORKER_URL ?? "https://xapi.prishtina-online.workers.dev";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function printSteps(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  X session setup — pick ONE method below                         ║
╚══════════════════════════════════════════════════════════════════╝

FIRST: open https://x.com in Chrome/Edge and LOG IN (you must see your home feed).

── Method A (easiest): "Copy as cURL" ──
  1. F12 → Network tab → F5 to refresh
  2. Click any row in the list (name like "Home" or "x.com")
  3. RIGHT-CLICK that row → Copy → "Copy as cURL (bash)" or "(cmd)"
  4. Paste the whole thing here (can be multiple lines)

── Method B: Cookie-Editor extension ──
  1. Install "Cookie-Editor" from Chrome Web Store
  2. On x.com (logged in), click the extension icon → Export → Export as JSON
  3. Paste the JSON here

── Method C: cookie header only ──
  Network → click a row → Headers → Request Headers → copy the "cookie:" value

We only use auth_token, ct0, and twid. Nothing is saved to disk.
`);
}

function readCookieValue(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`(?:^|[;\\s])${name}=([^;\\s'"]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function buildCookieString(authToken: string, ct0: string, twid: string): string {
  return `auth_token=${authToken}; ct0=${ct0}; twid=${twid}`;
}

function extractFromCookieBlob(raw: string): string {
  const authToken = readCookieValue(raw, "auth_token");
  const ct0 = readCookieValue(raw, "ct0");
  const twid = readCookieValue(raw, "twid");

  const missing = [
    !authToken && "auth_token",
    !ct0 && "ct0",
    !twid && "twid",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")}`);
  }

  return buildCookieString(authToken!, ct0!, twid!);
}

function extractFromCurl(raw: string): string {
  // Windows cmd: -H "cookie: ..."  |  bash: -H 'cookie: ...'  |  --cookie "..."
  const patterns = [
    /(?:-H|--header)\s+["']cookie:\s*([^"']+)["']/i,
    /(?:--cookie|-b)\s+["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return extractFromCookieBlob(match[1]);
    }
  }

  // Whole cURL blob often still contains auth_token=... inline
  return extractFromCookieBlob(raw);
}

function extractFromCookieEditorJson(raw: string): string {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array from Cookie-Editor");
  }

  const byName = new Map<string, string>();
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === "object" &&
      "name" in entry &&
      "value" in entry &&
      typeof (entry as { name: unknown }).name === "string" &&
      typeof (entry as { value: unknown }).value === "string"
    ) {
      byName.set((entry as { name: string }).name, (entry as { value: string }).value);
    }
  }

  const authToken = byName.get("auth_token");
  const ct0 = byName.get("ct0");
  const twid = byName.get("twid");

  if (!authToken || !ct0 || !twid) {
    throw new Error("JSON export is missing auth_token, ct0, or twid — log into x.com first");
  }

  return buildCookieString(authToken, ct0, twid);
}

function parsePaste(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("empty paste");
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return extractFromCookieEditorJson(trimmed);
  }

  if (/curl\s/i.test(trimmed) || /(?:-H|--header|--cookie|-b)\s/i.test(trimmed)) {
    return extractFromCurl(trimmed);
  }

  return extractFromCookieBlob(trimmed);
}

async function askSecret(rl: ReturnType<typeof createInterface>, label: string): Promise<string> {
  const value = (await rl.question(`${label}: `)).trim();
  if (!value) {
    throw new Error(`empty ${label}`);
  }
  return value;
}

async function readMultilinePaste(rl: ReturnType<typeof createInterface>): Promise<string> {
  console.log("Paste below, then press Enter twice when done:\n");

  const lines: string[] = [];
  while (true) {
    const line = await rl.question("");
    if (line === "" && lines.length > 0) {
      break;
    }
    lines.push(line);
  }

  return lines.join("\n").trim();
}

async function deploySecret(encoded: string): Promise<void> {
  console.log("\nUploading X_SESSION_TOKEN to Cloudflare (wrangler secret put)...\n");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "secret", "put", "X_SESSION_TOKEN"], {
      cwd: projectRoot,
      stdio: ["pipe", "inherit", "inherit"],
      shell: true,
    });

    child.stdin.write(`${encoded}\n`);
    child.stdin.end();

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler secret put exited with code ${code}`));
    });
  });
}

async function checkHealth(): Promise<void> {
  console.log(`\nChecking ${WORKER_URL} ...\n`);
  const res = await fetch(WORKER_URL);
  const body = (await res.json()) as {
    secretsConfigured?: { X_SESSION_TOKEN?: boolean };
  };

  if (body.secretsConfigured?.X_SESSION_TOKEN) {
    console.log("✓ X_SESSION_TOKEN is live on the worker.\n");
    console.log("Next (once per deploy): start the listener with your admin token:");
    console.log(
      `  curl -X POST ${WORKER_URL}/admin/listener/start -H "Authorization: Bearer YOUR_ADMIN_TOKEN"\n`,
    );
  } else {
    console.log("⚠ Health check still shows X_SESSION_TOKEN: false.");
    console.log("  Wait ~30s and refresh, or re-run this script if the secret upload failed.\n");
  }
}

async function main(): Promise<void> {
  printSteps();

  const rl = createInterface({ input, output });
  try {
    const pasted = await readMultilinePaste(rl);

    let cookie: string;
    try {
      cookie = parsePaste(pasted);
      console.log("\n✓ Found auth_token, ct0, and twid.");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "could not parse paste";
      console.log(`\nCouldn't parse automatically (${reason}). Enter three values separately:\n`);
      const authToken = await askSecret(rl, "auth_token");
      const ct0 = await askSecret(rl, "ct0");
      const twid = await askSecret(rl, "twid");
      cookie = buildCookieString(authToken, ct0, twid);
    }

    const encoded = AuthService.encodeCookie(cookie);
    console.log("\nEncoded session token (first 24 chars):", encoded.slice(0, 24) + "...");
    await deploySecret(encoded);
    await checkHealth();
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("\nSetup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
