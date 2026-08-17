// Reputation / blacklist probe — 10 attributes.
//
// Most reputation data (DNSBL lookups, WHOIS expiry, Google Safe Browsing)
// requires either raw UDP DNS or paid external APIs that aren't available from
// Workers without additional bindings. Attributes that CAN be checked are done
// here; the rest return null with a comment explaining the gap.
//
// Attributes that need external APIs and return null:
// - domain_on_spam_blacklist  → requires DNSBL UDP (or paid API like MXToolbox)
// - hosting_ip_on_blacklist   → same
// - whois_domain_age          → WHOIS requires raw TCP port 43
// - whois_privacy_enabled     → same
// - domain_expiry_over_90d    → same
// - certificate_transparency_log_reviewed → crt.sh API (feasible via fetch — implemented)
// - no_typosquat_lookalikes_flagged → requires external API
// - google_safe_browsing_clean → requires Google API key
// - no_malware_flags          → requires external API

export interface ReputationProbeResult {
  domain_on_spam_blacklist: boolean | null;
  hosting_ip_on_blacklist: boolean | null;
  whois_domain_age: number | null;
  whois_privacy_enabled: boolean | null;
  domain_expiry_over_90d: boolean | null;
  certificate_transparency_log_reviewed: boolean | null; // true if crt.sh has entries (cert exists + CT logged)
  no_typosquat_lookalikes_flagged: boolean | null;
  google_safe_browsing_clean: boolean | null;
  no_malware_flags: boolean | null;
  registrar_identified: string | null; // from RDAP (IANA's RDAP bootstrap, no auth needed)
}

interface RdapResponse {
  entities?: Array<{
    roles?: string[];
    vcardArray?: unknown;
    remarks?: Array<{ title?: string; description?: string[] }>;
  }>;
  remarks?: Array<{ title?: string; description?: string[] }>;
}

// RDAP bootstrap via IANA — returns the RDAP endpoint for the TLD, then queries it.
// No API key required; rate limits are generous for legitimate lookups.
async function queryRdap(hostname: string): Promise<RdapResponse | null> {
  try {
    // hostname is always dotted by the time it reaches a probe (see
    // admin-route.ts's canonicalizeHostname), so split(".") always has
    // >=2 parts -- the assertion just tells TS what that guarantees.
    const tld = hostname.split(".").slice(-1)[0]!;
    // IANA RDAP bootstrap
    const bootstrapRes = await fetch("https://data.iana.org/rdap/dns.json");
    if (!bootstrapRes.ok) return null;
    const bootstrap = (await bootstrapRes.json()) as {
      services: Array<[string[], string[]]>;
    };
    // Find the RDAP endpoint for this TLD
    const service = bootstrap.services.find(([tlds]) => tlds.includes(tld));
    if (!service) return null;
    const rdapBase = service[1][0];
    if (!rdapBase) return null;
    const rdapRes = await fetch(`${rdapBase}domain/${hostname}`);
    if (!rdapRes.ok) return null;
    return (await rdapRes.json()) as RdapResponse;
  } catch {
    return null;
  }
}

// crt.sh: check Certificate Transparency logs for this domain.
// Returns true if at least one cert is found (= domain is CT-logged, a positive signal).
async function checkCertTransparency(hostname: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as unknown[];
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}

// Parse registrar from RDAP entities
function extractRegistrar(rdap: RdapResponse): string | null {
  if (!rdap.entities) return null;
  for (const entity of rdap.entities) {
    if (entity.roles?.includes("registrar")) {
      // vcard name is in vcardArray[1] as an array of [type, params, "text", value]
      const vcard = entity.vcardArray;
      if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
        const fnEntry = (vcard[1] as unknown[][]).find(
          (e) => Array.isArray(e) && e[0] === "fn",
        );
        if (fnEntry && typeof fnEntry[3] === "string") return fnEntry[3];
      }
    }
  }
  return null;
}

export async function probeReputation(hostname: string): Promise<ReputationProbeResult> {
  const [rdap, ctCheck] = await Promise.all([
    queryRdap(hostname),
    checkCertTransparency(hostname),
  ]);

  const registrar_identified = rdap ? extractRegistrar(rdap) : null;

  return {
    domain_on_spam_blacklist: null,    // requires DNSBL UDP — not available from Workers
    hosting_ip_on_blacklist: null,     // same
    whois_domain_age: null,            // WHOIS TCP port 43 — not available from Workers
    whois_privacy_enabled: null,       // same
    domain_expiry_over_90d: null,      // same
    certificate_transparency_log_reviewed: ctCheck,
    no_typosquat_lookalikes_flagged: null, // requires external API
    google_safe_browsing_clean: null,  // requires Google API key
    no_malware_flags: null,            // requires external API
    registrar_identified,
  };
}
