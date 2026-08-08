import { describe, expect, it } from "vitest";
import { runSanityCheck } from "./sanity";
import { sequenceFetch } from "../../../test/helpers/mock-fetch";
import type { Env } from "../../types";

const fakeEnv = { GITHUB_TOKEN: "t" } as Env;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const repoMeta = {
  default_branch: "main",
  license: { spdx_id: "MIT" },
  html_url: "https://github.com/acme/widget",
  full_name: "acme/widget",
};

describe("runSanityCheck", () => {
  it("fails when the repo doesn't exist", async () => {
    const fetchImpl = sequenceFetch([jsonRes(404, { message: "Not Found" })]);
    const result = await runSanityCheck("acme", "ghost", fakeEnv, fetchImpl);
    expect(result).toEqual({ passed: false, reason: "repository not found", defaultBranch: null, headSha: null });
  });

  it("fails when there's no license and no substantive README", async () => {
    const fetchImpl = sequenceFetch([
      jsonRes(200, { ...repoMeta, license: null }),
      jsonRes(404, { message: "Not Found" }), // no README
    ]);
    const result = await runSanityCheck("acme", "widget", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/license/);
  });

  it("passes with a license even if the README is thin", async () => {
    const fetchImpl = sequenceFetch([
      jsonRes(200, repoMeta),
      jsonRes(200, { content: btoa("short"), encoding: "base64", path: "README.md" }),
      jsonRes(200, [{ sha: "b" }, { sha: "a" }]),
    ]);
    const result = await runSanityCheck("acme", "widget", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
    expect(result.headSha).toBe("b");
    expect(result.defaultBranch).toBe("main");
  });

  it("fails when there's only an initial commit", async () => {
    const fetchImpl = sequenceFetch([
      jsonRes(200, repoMeta),
      jsonRes(200, { content: btoa("short"), encoding: "base64", path: "README.md" }),
      jsonRes(200, [{ sha: "only-one" }]),
    ]);
    const result = await runSanityCheck("acme", "widget", fakeEnv, fetchImpl);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/commit history/);
  });

  it("passes on a substantive README even with no license", async () => {
    const longReadme = "# Widget\n\n" + "This tool does a lot of useful things. ".repeat(10);
    const fetchImpl = sequenceFetch([
      jsonRes(200, { ...repoMeta, license: null }),
      jsonRes(200, { content: btoa(longReadme), encoding: "base64", path: "README.md" }),
      jsonRes(200, [{ sha: "b" }, { sha: "a" }]),
    ]);
    const result = await runSanityCheck("acme", "widget", fakeEnv, fetchImpl);
    expect(result.passed).toBe(true);
  });
});
