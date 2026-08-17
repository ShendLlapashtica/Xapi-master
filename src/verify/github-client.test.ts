import { describe, expect, it } from "vitest";
import { getRawFile, getReadmeText, getRepo, listCommits, listRootContents } from "./github-client";
import { jsonFetch, sequenceFetch, textFetch } from "../../test/helpers/mock-fetch";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textRes(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("getRepo", () => {
  it("returns the parsed repo on success", async () => {
    const fetchImpl = jsonFetch(200, {
      default_branch: "main",
      license: { spdx_id: "MIT" },
      html_url: "https://github.com/acme/widget",
      full_name: "acme/widget",
    });
    const repo = await getRepo("acme", "widget", { token: "t", fetchImpl });
    expect(repo?.default_branch).toBe("main");
  });

  it("omits the authorization header when no token is provided, instead of sending an empty one", async () => {
    const fetchImpl = jsonFetch(200, {
      default_branch: "main",
      license: null,
      html_url: "https://github.com/acme/widget",
      full_name: "acme/widget",
    });
    await getRepo("acme", "widget", { token: "", fetchImpl });
    const [, initArg] = (fetchImpl as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((initArg.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("returns null on 404", async () => {
    const fetchImpl = jsonFetch(404, { message: "Not Found" });
    expect(await getRepo("acme", "ghost", { token: "t", fetchImpl })).toBeNull();
  });

  it("throws on other error statuses", async () => {
    const fetchImpl = jsonFetch(500, { message: "oops" });
    await expect(getRepo("acme", "widget", { token: "t", fetchImpl })).rejects.toThrow(/500/);
  });
});

describe("listCommits", () => {
  it("returns commits on success", async () => {
    const fetchImpl = jsonFetch(200, [{ sha: "a" }, { sha: "b" }]);
    const commits = await listCommits("acme", "widget", { token: "t", fetchImpl });
    expect(commits).toHaveLength(2);
  });

  it("returns an empty array for an empty repo (409)", async () => {
    const fetchImpl = jsonFetch(409, { message: "Git Repository is empty" });
    expect(await listCommits("acme", "widget", { token: "t", fetchImpl })).toEqual([]);
  });
});

describe("getReadmeText", () => {
  it("decodes a base64 README", async () => {
    const encoded = btoa("# Hello\n\nSome usage docs.");
    const fetchImpl = jsonFetch(200, { content: encoded, encoding: "base64", path: "README.md" });
    const text = await getReadmeText("acme", "widget", { token: "t", fetchImpl });
    expect(text).toBe("# Hello\n\nSome usage docs.");
  });

  it("returns null when there is no README", async () => {
    const fetchImpl = jsonFetch(404, { message: "Not Found" });
    expect(await getReadmeText("acme", "widget", { token: "t", fetchImpl })).toBeNull();
  });
});

describe("getRawFile", () => {
  it("returns raw text on success without attempting the fallback", async () => {
    const fetchImpl = textFetch(200, "console.log('hi');\n");
    const content = await getRawFile("acme", "widget", "main", "index.js", { token: "t", fetchImpl });
    expect(content).toBe("console.log('hi');\n");
    expect((fetchImpl as ReturnType<typeof import("vitest").vi.fn>).mock.calls).toHaveLength(1);
  });

  it("falls back to the authenticated Contents API when raw 404s and a token is present", async () => {
    const encoded = btoa("SECRET=shh\n");
    const fetchImpl = sequenceFetch([textRes(404, "Not Found"), jsonRes(200, { content: encoded, encoding: "base64", path: ".env" })]);
    const content = await getRawFile("acme", "private-widget", "main", ".env", { token: "t", fetchImpl });
    expect(content).toBe("SECRET=shh\n");
  });

  it("returns null when raw fails and no token is available, without attempting a fallback", async () => {
    const fetchImpl = textFetch(404, "Not Found");
    const content = await getRawFile("acme", "widget", "main", "missing.js", { token: "", fetchImpl });
    expect(content).toBeNull();
    expect((fetchImpl as ReturnType<typeof import("vitest").vi.fn>).mock.calls).toHaveLength(1);
  });

  it("returns null when both the raw fetch and the fallback fail", async () => {
    const fetchImpl = sequenceFetch([textRes(404, "Not Found"), jsonRes(404, { message: "Not Found" })]);
    const content = await getRawFile("acme", "ghost", "main", "missing.js", { token: "t", fetchImpl });
    expect(content).toBeNull();
  });
});

describe("listRootContents", () => {
  it("returns the root file listing", async () => {
    const fetchImpl = jsonFetch(200, [
      { name: "package.json", type: "file" },
      { name: "src", type: "dir" },
    ]);
    const entries = await listRootContents("acme", "widget", { token: "t", fetchImpl });
    expect(entries.map((e) => e.name)).toEqual(["package.json", "src"]);
  });
});
