import { describe, expect, it } from "vitest";
import { detectStack } from "./stack-detect";

describe("detectStack", () => {
  it("detects node from package.json", () => {
    expect(detectStack(["package.json", "README.md"])).toBe("node");
  });

  it("detects python from pyproject.toml", () => {
    expect(detectStack(["pyproject.toml"])).toBe("python");
  });

  it("detects python from requirements.txt", () => {
    expect(detectStack(["requirements.txt", "README.md"])).toBe("python");
  });

  it("detects go from go.mod", () => {
    expect(detectStack(["go.mod", "go.sum"])).toBe("go");
  });

  it("detects rust from Cargo.toml", () => {
    expect(detectStack(["Cargo.toml", "Cargo.lock"])).toBe("rust");
  });

  it("returns unsupported when no known manifest is present", () => {
    expect(detectStack(["README.md", "LICENSE"])).toBe("unsupported");
  });

  it("prefers node when multiple manifests are present", () => {
    expect(detectStack(["package.json", "pyproject.toml"])).toBe("node");
  });

  it("handles an empty file list", () => {
    expect(detectStack([])).toBe("unsupported");
  });
});
