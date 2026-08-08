import { describe, expect, it } from "vitest";
import { canonicalizeGithubUrl } from "./github-url";

describe("canonicalizeGithubUrl", () => {
  it("canonicalizes a plain repo URL", () => {
    expect(canonicalizeGithubUrl("https://github.com/acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
      subpath: null,
      canonicalUrl: "https://github.com/acme/widget",
    });
  });

  it("strips a trailing .git", () => {
    expect(canonicalizeGithubUrl("https://github.com/acme/widget.git")?.repo).toBe("widget");
  });

  it("strips trailing slash and query string", () => {
    const result = canonicalizeGithubUrl("https://github.com/acme/widget/?utm_source=x");
    expect(result?.canonicalUrl).toBe("https://github.com/acme/widget");
    expect(result?.subpath).toBeNull();
  });

  it("collapses a monorepo sub-path to the root repo, keeping the sub-path", () => {
    const result = canonicalizeGithubUrl(
      "https://github.com/acme/widget/tree/main/packages/core",
    );
    expect(result?.canonicalUrl).toBe("https://github.com/acme/widget");
    expect(result?.subpath).toBe("tree/main/packages/core");
  });

  it("normalizes www.github.com", () => {
    expect(canonicalizeGithubUrl("https://www.github.com/acme/widget")?.canonicalUrl).toBe(
      "https://github.com/acme/widget",
    );
  });

  it("rejects non-github hosts", () => {
    expect(canonicalizeGithubUrl("https://gitlab.com/acme/widget")).toBeNull();
  });

  it("rejects raw.githubusercontent.com", () => {
    expect(
      canonicalizeGithubUrl("https://raw.githubusercontent.com/acme/widget/main/README.md"),
    ).toBeNull();
  });

  it("rejects gist.github.com", () => {
    expect(canonicalizeGithubUrl("https://gist.github.com/someuser/abc123")).toBeNull();
  });

  it("rejects reserved top-level paths that aren't repos", () => {
    expect(canonicalizeGithubUrl("https://github.com/marketplace/actions")).toBeNull();
    expect(canonicalizeGithubUrl("https://github.com/settings/profile")).toBeNull();
    expect(canonicalizeGithubUrl("https://github.com/orgs/acme/people")).toBeNull();
  });

  it("rejects a bare owner URL with no repo", () => {
    expect(canonicalizeGithubUrl("https://github.com/acme")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(canonicalizeGithubUrl("not a url")).toBeNull();
  });
});
