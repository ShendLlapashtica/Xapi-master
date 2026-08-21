import type { FixtureExpectedProfile, FixtureOutcome, StructuralElement } from "../types";

// Classifies a single capability-fixture run. The three-way split
// (usable / unusable / invocation_error) is the hardest judgment call in the
// brief (§4.3): a nonzero exit or empty output could mean the tool is broken,
// or could mean we guessed its CLI invocation wrong. `invocation_error` is a
// distinct, cheap, deliberately conservative signal for the latter — it must
// never fire just because a tool legitimately failed on real input.
const INVOCATION_ERROR_EXIT_CODES = new Set([126, 127, 2]);
const INVOCATION_ERROR_STDERR_PATTERN =
  /^(usage:|unrecognized argument|unknown option|invalid choice|command not found)/i;

export interface FixtureRunResult {
  exitCode: number | null;
  stderr: string;
  outputText: string | null;
}

export interface FixtureOutcomeResult {
  outcome: FixtureOutcome;
  wordCount: number | null;
  detectedStructures: StructuralElement[];
}

export function classifyFixtureOutcome(
  run: FixtureRunResult,
  expected: FixtureExpectedProfile,
): FixtureOutcomeResult {
  if (isInvocationError(run)) {
    return { outcome: "invocation_error", wordCount: null, detectedStructures: [] };
  }

  const wordCount = countWords(run.outputText);
  const detectedStructures = detectStructures(run.outputText);

  const clearsBar =
    run.exitCode === 0 &&
    run.outputText !== null &&
    run.outputText.trim().length > 0 &&
    wordCount >= expected.minWordCount &&
    (expected.expectedStructures.length === 0 ||
      expected.expectedStructures.some((s) => detectedStructures.includes(s))) &&
    anchorsInOrder(run.outputText, expected.expectedOrderedAnchors);

  return {
    outcome: clearsBar ? "usable" : "unusable",
    wordCount,
    detectedStructures,
  };
}

function isInvocationError(run: FixtureRunResult): boolean {
  if (run.exitCode !== null && INVOCATION_ERROR_EXIT_CODES.has(run.exitCode)) {
    return true;
  }
  const firstLine = run.stderr.split(/\r?\n/, 1)[0] ?? "";
  return INVOCATION_ERROR_STDERR_PATTERN.test(firstLine.trim());
}

function countWords(text: string | null): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function detectStructures(text: string | null): StructuralElement[] {
  if (!text) return [];
  const found = new Set<StructuralElement>();

  const hasMarkdownHeading = /^#{1,6}\s+\S/m.test(text);
  const hasHtmlHeading = /<h[1-6][\s>]/i.test(text);
  if (hasMarkdownHeading || hasHtmlHeading) found.add("heading");

  const hasMarkdownTable = /^\s*\|.*\|\s*\n\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/m.test(text);
  const hasHtmlTable = /<table[\s>]/i.test(text);
  if (hasMarkdownTable || hasHtmlTable) found.add("table");

  return [...found];
}

// Whitespace-normalized, case-insensitive substring search, so a phrase
// that happens to fall across a line-wrap in the tool's output still
// matches. Absence of the constraint (undefined/empty) always passes --
// this only ever adds a bar, never removes the ones above it.
function anchorsInOrder(text: string | null, anchors: string[] | undefined): boolean {
  if (!anchors || anchors.length === 0) return true;
  if (!text) return false;

  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const haystack = normalize(text);

  let searchFrom = 0;
  for (const anchor of anchors) {
    const needle = normalize(anchor);
    const foundAt = haystack.indexOf(needle, searchFrom);
    if (foundAt === -1) return false;
    searchFrom = foundAt + needle.length;
  }
  return true;
}
