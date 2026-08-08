// Builds the compound `search/recent` query that covers the whole tracked
// roster in a single call, per BRIEF.md's "one call covers the whole roster"
// design (rather than one call per account).

export function buildSearchQuery(handles: string[]): string {
  if (handles.length === 0) {
    throw new Error("buildSearchQuery requires at least one handle");
  }
  const clauses = handles.map((h) => `from:${normalizeHandle(h)}`).join(" OR ");
  return `(${clauses}) -is:reply`;
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}
