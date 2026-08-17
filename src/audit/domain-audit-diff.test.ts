import { describe, expect, it } from "vitest";
import { diffAttributes } from "./domain-audit-diff";
import type { DomainAuditAttributes } from "../types";

function attrs(overrides: Partial<DomainAuditAttributes>): DomainAuditAttributes {
  return { hsts_header_present: false, tls_certificate_expiry_over_30d: true, ...overrides } as DomainAuditAttributes;
}

describe("diffAttributes", () => {
  it("returns an empty diff when nothing changed", () => {
    const a = attrs({});
    const b = attrs({});
    expect(diffAttributes(a, b)).toEqual({});
  });

  it("reports only the keys that changed", () => {
    const prev = attrs({ hsts_header_present: false });
    const curr = attrs({ hsts_header_present: true });
    expect(diffAttributes(prev, curr)).toEqual({
      hsts_header_present: { from: false, to: true },
    });
  });

  it("reports multiple changed keys independently", () => {
    const prev = attrs({ hsts_header_present: false, tls_certificate_expiry_over_30d: true });
    const curr = attrs({ hsts_header_present: true, tls_certificate_expiry_over_30d: false });
    expect(diffAttributes(prev, curr)).toEqual({
      hsts_header_present: { from: false, to: true },
      tls_certificate_expiry_over_30d: { from: true, to: false },
    });
  });

  it("treats a value changing to/from null as a change", () => {
    const prev = attrs({ hsts_header_present: null });
    const curr = attrs({ hsts_header_present: true });
    expect(diffAttributes(prev, curr)).toEqual({
      hsts_header_present: { from: null, to: true },
    });
  });
});
