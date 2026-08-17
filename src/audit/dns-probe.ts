// DNS probe — 15 attributes via Cloudflare DNS-over-HTTPS (application/dns-json).
// All lookups use GET https://cloudflare-dns.com/dns-query?name=...&type=...
// which is reachable from Workers on all plans.

export interface DnsProbeResult {
  // DNS fundamentals (15)
  a_record_present: boolean | null;
  aaaa_record_present: boolean | null;
  ns_record_count: number | null;
  ns_provider_diversity: boolean | null;   // true if NS apex domains differ (not single provider)
  soa_serial_format_valid: boolean | null; // YYYYMMDDNN format
  soa_refresh_value_sane: boolean | null;  // 3600-86400
  soa_retry_value_sane: boolean | null;    // 600-7200
  soa_expire_value_in_range: boolean | null; // 604800-2419200
  soa_minimum_ttl_sane: boolean | null;    // 300-86400
  caa_record_present: boolean | null;
  caa_restricts_issuance: boolean | null;  // has an `issue` or `issuewild` tag
  dnssec_enabled: boolean | null;          // AD flag set in DoH response
  ttl_reasonable: boolean | null;          // A record TTL between 60-86400
  glue_records_correct: boolean | null;    // heuristic: NS resolves to same IP as A
  zone_transfer_axfr_disabled: boolean | null; // always null (can't test AXFR from Workers)

  // Raw values for audit trail
  _aRecordTtl: number | null;
  _nsApexDomains: string[];
  _resolvedIp: string | null;
}

interface DoHResponse {
  Status: number;
  AD?: boolean; // Authenticated Data — DNSSEC validated
  Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

async function dohQuery(name: string, type: string): Promise<DoHResponse | null> {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      // Workers fetch timeout: 30s by default; DoH is fast so this is fine.
    });
    if (!res.ok) return null;
    return (await res.json()) as DoHResponse;
  } catch {
    return null;
  }
}

function nsApexDomain(ns: string): string {
  // "ns1.registrar-servers.com." → "registrar-servers.com"
  const labels = ns.replace(/\.$/, "").split(".");
  return `${labels.at(-2) ?? ""}${labels.at(-2) ? "." : ""}${labels.at(-1) ?? ""}`;
}

export async function probeDns(hostname: string): Promise<DnsProbeResult> {
  const [aRes, aaaaRes, nsRes, soaRes, caaRes, dsRes] = await Promise.all([
    dohQuery(hostname, "A"),
    dohQuery(hostname, "AAAA"),
    dohQuery(hostname, "NS"),
    dohQuery(hostname, "SOA"),
    dohQuery(hostname, "CAA"),
    dohQuery(hostname, "DS"), // DS record presence = DNSSEC signed zone
  ]);

  // A
  const aRecords = aRes?.Answer?.filter((r) => r.type === 1) ?? [];
  const a_record_present = aRes !== null ? aRecords.length > 0 : null;
  const _resolvedIp = aRecords[0]?.data ?? null;
  const _aRecordTtl = aRecords[0]?.TTL ?? null;
  const ttl_reasonable =
    _aRecordTtl !== null ? _aRecordTtl >= 60 && _aRecordTtl <= 86400 : null;

  // AAAA
  const aaaaRecords = aaaaRes?.Answer?.filter((r) => r.type === 28) ?? [];
  const aaaa_record_present = aaaaRes !== null ? aaaaRecords.length > 0 : null;

  // NS
  const nsRecords = nsRes?.Answer?.filter((r) => r.type === 2) ?? [];
  const ns_record_count = nsRes !== null ? nsRecords.length : null;
  const _nsApexDomains = [...new Set(nsRecords.map((r) => nsApexDomain(r.data)))];
  const ns_provider_diversity = nsRes !== null ? _nsApexDomains.length > 1 : null;

  // SOA — data format: "mname rname serial refresh retry expire minimum"
  const soaRecord = soaRes?.Answer?.find((r) => r.type === 6);
  let soa_serial_format_valid: boolean | null = null;
  let soa_refresh_value_sane: boolean | null = null;
  let soa_retry_value_sane: boolean | null = null;
  let soa_expire_value_in_range: boolean | null = null;
  let soa_minimum_ttl_sane: boolean | null = null;
  if (soaRecord) {
    const parts = soaRecord.data.trim().split(/\s+/);
    if (parts.length >= 7) {
      const [, , serial, refresh, retry, expire, minimum] = parts as [string, string, string, string, string, string, string];
      soa_serial_format_valid = /^\d{10}$/.test(serial); // YYYYMMDDNN = 10 digits
      soa_refresh_value_sane = Number(refresh) >= 3600 && Number(refresh) <= 86400;
      soa_retry_value_sane = Number(retry) >= 600 && Number(retry) <= 7200;
      soa_expire_value_in_range = Number(expire) >= 604800 && Number(expire) <= 2419200;
      soa_minimum_ttl_sane = Number(minimum) >= 300 && Number(minimum) <= 86400;
    }
  }

  // CAA
  const caaRecords = caaRes?.Answer?.filter((r) => r.type === 257) ?? [];
  const caa_record_present = caaRes !== null ? caaRecords.length > 0 : null;
  const caa_restricts_issuance =
    caa_record_present !== null
      ? caaRecords.some((r) => /\bissue\b|\bissuewild\b/.test(r.data))
      : null;

  // DNSSEC: AD flag on A response OR DS record present
  const dnssec_enabled =
    aRes !== null || dsRes !== null
      ? Boolean(aRes?.AD) || (dsRes?.Answer ?? []).length > 0
      : null;

  // Glue heuristic: all NS hostnames resolve to at least one IP
  // We skip this full lookup to stay fast; mark as null (undetermined).
  const glue_records_correct: boolean | null = null;

  return {
    a_record_present,
    aaaa_record_present,
    ns_record_count,
    ns_provider_diversity,
    soa_serial_format_valid,
    soa_refresh_value_sane,
    soa_retry_value_sane,
    soa_expire_value_in_range,
    soa_minimum_ttl_sane,
    caa_record_present,
    caa_restricts_issuance,
    dnssec_enabled,
    ttl_reasonable,
    glue_records_correct,
    zone_transfer_axfr_disabled: null, // AXFR requires raw TCP — not testable from Workers
    _aRecordTtl,
    _nsApexDomains,
    _resolvedIp,
  };
}
