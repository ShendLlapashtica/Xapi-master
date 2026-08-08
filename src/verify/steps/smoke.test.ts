import { describe, expect, it } from "vitest";
import { detectStackForRepo } from "./smoke";
import { jsonFetch, sequenceFetch } from "../../../test/helpers/mock-fetch";
import type { Env } from "../../types";

const fakeEnv = { GITHUB_TOKEN: "t" } as Env;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("detectStackForRepo", () => {
  it("detects the stack from the root file listing", async () => {
    const fetchImpl = jsonFetch(200, [
      { name: "package.json", type: "file" },
      { name: "src", type: "dir" },
    ]);
    expect(await detectStackForRepo("acme", "widget", "main", fakeEnv, fetchImpl)).toEqual({
      stack: "node",
      packageDir: null,
    });
  });

  it("returns unsupported with no packageDir when nothing matches anywhere", async () => {
    const fetchImpl = jsonFetch(200, [{ name: "README.md", type: "file" }]);
    expect(await detectStackForRepo("acme", "widget", "main", fakeEnv, fetchImpl)).toEqual({
      stack: "unsupported",
      packageDir: null,
    });
  });

  it("finds a manifest in a repo-named subdirectory of a monorepo container dir (e.g. libs/<repo>)", async () => {
    const fetchImpl = sequenceFetch([
      // root: no manifest, but a "libs" directory exists
      jsonRes(200, [
        { name: "README.md", type: "file" },
        { name: "libs", type: "dir" },
      ]),
      // libs/ itself: no manifest directly, but has a subdir named after the repo
      jsonRes(200, [
        { name: "widget", type: "dir" },
        { name: "core", type: "dir" },
      ]),
      // libs/widget/: the real manifest
      jsonRes(200, [{ name: "pyproject.toml", type: "file" }]),
    ]);
    const result = await detectStackForRepo("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result).toEqual({ stack: "python", packageDir: "libs/widget" });
  });

  it("finds a manifest directly inside a monorepo container dir (e.g. packages/*)", async () => {
    const fetchImpl = sequenceFetch([
      jsonRes(200, [{ name: "packages", type: "dir" }]),
      jsonRes(200, [{ name: "package.json", type: "file" }]),
    ]);
    const result = await detectStackForRepo("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result).toEqual({ stack: "node", packageDir: "packages" });
  });

  it("does not guess when the container dir has no repo-named subdirectory", async () => {
    const fetchImpl = sequenceFetch([
      jsonRes(200, [{ name: "libs", type: "dir" }]),
      jsonRes(200, [
        { name: "core", type: "dir" },
        { name: "community", type: "dir" },
      ]),
    ]);
    const result = await detectStackForRepo("acme", "widget", "main", fakeEnv, fetchImpl);
    expect(result).toEqual({ stack: "unsupported", packageDir: null });
  });
});
