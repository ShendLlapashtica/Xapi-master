import { describe, expect, it } from "vitest";
import { runSecretsScan } from "./secrets-scan";
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

describe("runSecretsScan", () => {
  it("passes cleanly on a repo with no matching files", async () => {
    const fetchImpl = sequenceFetch([treeRes([{ path: "README.md", size: 50 }])]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result).toEqual({ passed: true, findings: [], filesScanned: 0 });
  });

  it("passes when scanned files are benign", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "index.js", size: 100 }]),
      textRes("console.log('hello world');\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
    expect(result.filesScanned).toBe(1);
  });

  it("flags an AWS access key id", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: ".env", size: 100 }]),
      textRes("AWS_KEY=AKIAIOSFODNN7EXAMPLE\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("aws-access-key-id");
  });

  it("flags a generic api-key assignment", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "config.ini", size: 100 }]),
      textRes('api_key = "sk-abcdefghijklmnopqrstuvwx"\n'),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("generic-api-key-assignment");
  });

  it("flags a PEM private key block", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "certs/server.pem", size: 100 }]),
      textRes("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQ...\n-----END RSA PRIVATE KEY-----\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("pem-private-key");
    expect(result.findings[0]?.file).toBe("certs/server.pem");
  });

  it("flags a Slack token", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "notify.py", size: 100 }]),
      textRes("SLACK_TOKEN = 'xoxb-1234567890-abcdefghijk'\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("slack-token");
  });

  it("flags a GitHub PAT", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: "deploy.sh", size: 100 }]),
      textRes("export GH_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.pattern).toBe("github-pat");
  });

  it("redacts the snippet instead of storing the raw match", async () => {
    const fetchImpl = sequenceFetch([
      treeRes([{ path: ".env", size: 100 }]),
      textRes("AWS_KEY=AKIAIOSFODNN7EXAMPLE\n"),
    ]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    const snippet = result.findings[0]?.snippet ?? "";
    expect(snippet).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(snippet).toMatch(/^AKIA…[A-Z0-9]{4}$/);
  });

  it("skips files above the size ceiling", async () => {
    const fetchImpl = sequenceFetch([treeRes([{ path: "vendor/bundle.js", size: 5_000_000 }])]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.filesScanned).toBe(0);
  });

  it("caps the number of files scanned", async () => {
    const manyFiles = Array.from({ length: 45 }, (_, i) => ({ path: `src/file${i}.js`, size: 10 }));
    const fetchImpl = sequenceFetch([treeRes(manyFiles), ...Array.from({ length: 45 }, () => textRes("// benign\n"))]);
    const result = await runSecretsScan("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result.filesScanned).toBe(30);
  });
});
