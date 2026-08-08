// Cheap duplicate/template detection: a hash of the README after stripping
// everything that varies between copies of the same template (images,
// links, numbers -- stats, dates, dollar amounts) but keeping the
// structural/prose text. Exact-match only -- catches literal copy-paste
// template reuse (confirmed live 2026-08-08/09: multiple "polymarket
// trading bot" repos from different authors sharing near-identical READMEs),
// not fuzzy near-duplicates. See verify-workflow.ts's classify step for how
// a match lets a repeat template skip a fresh, rate-limited Groq call.
export async function fingerprintReadme(readmeText: string): Promise<string> {
  const normalized = readmeText
    .toLowerCase()
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
