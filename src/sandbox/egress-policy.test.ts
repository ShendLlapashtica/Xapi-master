import { describe, expect, it } from "vitest";
import { computeEgressAllowlist } from "./egress-policy";

describe("computeEgressAllowlist", () => {
  it("allows the repo remote plus npm for node", () => {
    expect(computeEgressAllowlist("node", "github.com")).toEqual([
      "github.com",
      "registry.npmjs.org",
    ]);
  });

  it("allows both PyPI hosts for python", () => {
    expect(computeEgressAllowlist("python", "github.com")).toEqual([
      "github.com",
      "pypi.org",
      "files.pythonhosted.org",
    ]);
  });

  it("allows both Go module proxy hosts for go", () => {
    expect(computeEgressAllowlist("go", "github.com")).toEqual([
      "github.com",
      "proxy.golang.org",
      "sum.golang.org",
    ]);
  });

  it("allows the crates.io family for rust", () => {
    expect(computeEgressAllowlist("rust", "github.com")).toEqual([
      "github.com",
      "crates.io",
      "static.crates.io",
      "index.crates.io",
    ]);
  });

  it("dedupes if the repo remote happens to be a registry host", () => {
    expect(computeEgressAllowlist("node", "registry.npmjs.org")).toEqual(["registry.npmjs.org"]);
  });
});
