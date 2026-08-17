// Email / SMTP probe — 20 attributes.
// Uses DNS-over-HTTPS for MX, TXT (SPF/DMARC/DKIM/BIMI/MTA-STS/_smtp._tls).
// SMTP-level tests (open relay, STARTTLS, reverse PTR) require raw TCP —
// not available from Workers — those attributes are returned as null.

export interface EmailProbeResult {
  mx_record_present: boolean | null;
  mx_priority_sane: boolean | null;        // lowest MX priority ≤ 50
  spf_record_present: boolean | null;
  spf_syntax_valid: boolean | null;
  spf_mechanism_strictness: "hard_fail" | "soft_fail" | "neutral" | "missing" | null;
  spf_lookup_count_under_10: boolean | null;
  dmarc_record_present: boolean | null;
  dmarc_policy_level: "none" | "quarantine" | "reject" | "missing" | null;
  dmarc_pct_100: boolean | null;
  dmarc_reporting_configured: boolean | null; // rua= or ruf= present
  dmarc_alignment_mode: string | null;        // "relaxed" | "strict"
  dkim_selector_published: boolean | null;    // checks "default._domainkey"
  dkim_key_strength_adequate: boolean | null; // null — can't inspect key bits via DoH
  bimi_record_present: boolean | null;
  bimi_logo_renders_in_inbox: boolean | null; // null — can't verify rendering
  reverse_dns_matches_smtp_banner: boolean | null; // null — requires SMTP TCP
  smtp_starttls_supported: boolean | null;    // null — requires SMTP TCP
  smtp_open_relay_test_passed: boolean | null; // null — requires SMTP TCP
  mta_sts_policy_published: boolean | null;   // checks _mta-sts TXT + https://mta-sts.{host}/.well-known/mta-sts.txt
  tls_rpt_configured: boolean | null;         // checks _smtp._tls TXT
}

interface DoHResponse {
  Status: number;
  Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

async function dohQuery(name: string, type: string): Promise<DoHResponse | null> {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
    if (!res.ok) return null;
    return (await res.json()) as DoHResponse;
  } catch {
    return null;
  }
}

function getTxtRecords(res: DoHResponse | null): string[] {
  if (!res?.Answer) return [];
  return res.Answer.filter((r) => r.type === 16).map((r) =>
    // DoH wraps TXT data in quotes
    r.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""),
  );
}

function countSpfLookups(spf: string): number {
  // Mechanisms that cause DNS lookups: include, a, mx, ptr, exists
  return (spf.match(/\b(include|a|mx|ptr|exists):/gi) ?? []).length;
}

export async function probeEmail(hostname: string): Promise<EmailProbeResult> {
  const [mxRes, spfRes, dmarcRes, dkimRes, bimiRes, mtaStsRes, tlsRptRes] = await Promise.all([
    dohQuery(hostname, "MX"),
    dohQuery(hostname, "TXT"),
    dohQuery(`_dmarc.${hostname}`, "TXT"),
    dohQuery(`default._domainkey.${hostname}`, "TXT"),
    dohQuery(`default._bimi.${hostname}`, "TXT"),
    dohQuery(`_mta-sts.${hostname}`, "TXT"),
    dohQuery(`_smtp._tls.${hostname}`, "TXT"),
  ]);

  // MX
  const mxRecords = mxRes?.Answer?.filter((r) => r.type === 15) ?? [];
  const mx_record_present = mxRes !== null ? mxRecords.length > 0 : null;
  const mxPriorities = mxRecords.map((r) => {
    const priority = parseInt(r.data.split(/\s+/)[0] ?? "999", 10);
    return isNaN(priority) ? 999 : priority;
  });
  const mx_priority_sane =
    mxPriorities.length > 0 ? Math.min(...mxPriorities) <= 50 : mx_record_present === false ? false : null;

  // SPF — look for "v=spf1" in TXT records
  const txtRecords = getTxtRecords(spfRes);
  const spfRecord = txtRecords.find((t) => t.startsWith("v=spf1"));
  const spf_record_present = spfRes !== null ? Boolean(spfRecord) : null;
  let spf_syntax_valid: boolean | null = null;
  let spf_mechanism_strictness: EmailProbeResult["spf_mechanism_strictness"] = null;
  let spf_lookup_count_under_10: boolean | null = null;

  if (spfRecord) {
    spf_syntax_valid = /^v=spf1(\s+\S+)+\s+[-~?+]all$/i.test(spfRecord);
    if (/-all/i.test(spfRecord)) spf_mechanism_strictness = "hard_fail";
    else if (/~all/i.test(spfRecord)) spf_mechanism_strictness = "soft_fail";
    else if (/\?all/i.test(spfRecord)) spf_mechanism_strictness = "neutral";
    else if (/\+all/i.test(spfRecord)) spf_mechanism_strictness = "missing"; // "+all" is effectively missing any protection
    else spf_mechanism_strictness = "missing";
    spf_lookup_count_under_10 = countSpfLookups(spfRecord) < 10;
  } else if (spf_record_present === false) {
    spf_mechanism_strictness = "missing";
  }

  // DMARC
  const dmarcTxt = getTxtRecords(dmarcRes).find((t) => t.startsWith("v=DMARC1"));
  const dmarc_record_present = dmarcRes !== null ? Boolean(dmarcTxt) : null;
  let dmarc_policy_level: EmailProbeResult["dmarc_policy_level"] = null;
  let dmarc_pct_100: boolean | null = null;
  let dmarc_reporting_configured: boolean | null = null;
  let dmarc_alignment_mode: string | null = null;

  if (dmarcTxt) {
    const pMatch = dmarcTxt.match(/\bp=(\w+)/i);
    const policy = pMatch?.[1]?.toLowerCase();
    dmarc_policy_level = (policy as EmailProbeResult["dmarc_policy_level"]) ?? "none";
    const pctMatch = dmarcTxt.match(/\bpct=(\d+)/i);
    dmarc_pct_100 = pctMatch ? Number(pctMatch[1]) === 100 : true; // default is 100
    dmarc_reporting_configured = /\brua=/.test(dmarcTxt) || /\bruf=/.test(dmarcTxt);
    // adkim / aspf alignment — default is "r" (relaxed)
    const adkimMatch = dmarcTxt.match(/\badkim=([rs])/i);
    dmarc_alignment_mode = adkimMatch ? (adkimMatch[1] === "s" ? "strict" : "relaxed") : "relaxed";
  } else if (dmarc_record_present === false) {
    dmarc_policy_level = "missing";
  }

  // DKIM (checking "default" selector — common default)
  const dkimTxt = getTxtRecords(dkimRes).find((t) => /v=DKIM1/i.test(t));
  const dkim_selector_published = dkimRes !== null ? Boolean(dkimTxt) : null;

  // BIMI
  const bimiTxt = getTxtRecords(bimiRes).find((t) => /v=BIMI1/i.test(t));
  const bimi_record_present = bimiRes !== null ? Boolean(bimiTxt) : null;

  // MTA-STS: _mta-sts TXT record + well-known policy file
  const mtaStsTxt = getTxtRecords(mtaStsRes).find((t) => /v=STSv1/i.test(t));
  let mta_sts_policy_published: boolean | null = null;
  if (mtaStsRes !== null) {
    if (mtaStsTxt) {
      // Also check the HTTPS policy file endpoint
      try {
        const policyRes = await fetch(`https://mta-sts.${hostname}/.well-known/mta-sts.txt`, {
          method: "HEAD",
        });
        mta_sts_policy_published = policyRes.ok;
      } catch {
        mta_sts_policy_published = false;
      }
    } else {
      mta_sts_policy_published = false;
    }
  }

  // TLS-RPT
  const tlsRptTxt = getTxtRecords(tlsRptRes).find((t) => /v=TLSRPTv1/i.test(t));
  const tls_rpt_configured = tlsRptRes !== null ? Boolean(tlsRptTxt) : null;

  return {
    mx_record_present,
    mx_priority_sane,
    spf_record_present,
    spf_syntax_valid,
    spf_mechanism_strictness,
    spf_lookup_count_under_10,
    dmarc_record_present,
    dmarc_policy_level,
    dmarc_pct_100,
    dmarc_reporting_configured,
    dmarc_alignment_mode,
    dkim_selector_published,
    dkim_key_strength_adequate: null, // key bit strength not extractable via DoH TXT parsing reliably
    bimi_record_present,
    bimi_logo_renders_in_inbox: null, // requires inbox rendering — not testable
    reverse_dns_matches_smtp_banner: null,
    smtp_starttls_supported: null,
    smtp_open_relay_test_passed: null,
    mta_sts_policy_published,
    tls_rpt_configured,
  };
}
