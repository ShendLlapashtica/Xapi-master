import { describe, expect, it } from "vitest";
import { isTerminalStatus, smokeReasoning, tierForStatus } from "./status";

describe("tierForStatus", () => {
  it("maps discovered and sanity:fail to none", () => {
    expect(tierForStatus("discovered")).toBe("none");
    expect(tierForStatus("sanity:fail")).toBe("none");
  });

  it("maps smoke:fail and smoke:unsupported_stack to sanity (smoke never cleared)", () => {
    expect(tierForStatus("smoke:fail")).toBe("sanity");
    expect(tierForStatus("smoke:unsupported_stack")).toBe("sanity");
  });

  it("maps smoke:pass to smoke", () => {
    expect(tierForStatus("smoke:pass")).toBe("smoke");
  });

  it("maps every capability:* status to capability", () => {
    expect(tierForStatus("capability:pass")).toBe("capability");
    expect(tierForStatus("capability:partial")).toBe("capability");
    expect(tierForStatus("capability:fail")).toBe("capability");
    expect(tierForStatus("capability:undetermined")).toBe("capability");
  });
});

describe("isTerminalStatus", () => {
  it("discovered is never terminal", () => {
    expect(isTerminalStatus("discovered", null)).toBe(false);
  });

  it("sanity:fail, smoke:fail, and smoke:unsupported_stack are always terminal", () => {
    expect(isTerminalStatus("sanity:fail", null)).toBe(true);
    expect(isTerminalStatus("smoke:fail", "other")).toBe(true);
    expect(isTerminalStatus("smoke:unsupported_stack", "document-parsing-conversion")).toBe(true);
  });

  it("smoke:pass is terminal for every category except document-parsing-conversion", () => {
    expect(isTerminalStatus("smoke:pass", "other")).toBe(true);
    expect(isTerminalStatus("smoke:pass", "ocr")).toBe(true);
    expect(isTerminalStatus("smoke:pass", null)).toBe(true);
  });

  it("smoke:pass is NOT terminal for document-parsing-conversion (capability tier still pending)", () => {
    expect(isTerminalStatus("smoke:pass", "document-parsing-conversion")).toBe(false);
  });

  it("every capability:* status is terminal", () => {
    expect(isTerminalStatus("capability:pass", "document-parsing-conversion")).toBe(true);
    expect(isTerminalStatus("capability:undetermined", "document-parsing-conversion")).toBe(true);
  });
});

describe("smokeReasoning", () => {
  it("reports the exit code on a failed build", () => {
    expect(smokeReasoning(false, 1, true)).toBe("build exited 1");
  });

  it("falls back to 'non-zero' when a failed build has no exit code", () => {
    expect(smokeReasoning(false, null, true)).toBe("build exited non-zero");
  });

  it("flags the unverified-functionality caveat when a passing build is terminal", () => {
    const reasoning = smokeReasoning(true, 0, true);
    expect(reasoning).toContain("build exited 0");
    expect(reasoning).toContain("functional claims are unverified");
  });

  it("omits the caveat when a passing build is not terminal (capability tier still pending)", () => {
    expect(smokeReasoning(true, 0, false)).toBe("build exited 0");
  });
});
