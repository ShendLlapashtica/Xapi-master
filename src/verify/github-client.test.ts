import { describe, expect, it } from "vitest";
import { getReadmeText, getRepo, listCommits, listRootContents } from "./github-client";
import { jsonFetch } from "../../test/helpers/mock-fetch";

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
