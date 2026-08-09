# firecrawl/anydoc, actually run -- correcting the earlier verdict

The first diligence entry tonight (`2026-08-09-batch-diverse-categories.md`)
verified `anydoc` at the classify tier only -- smoke never ran because it's
Rust and this pipeline's E2B sandbox has no Rust template yet. The
verdict at the time was "legitimate, real tool, worth the recommendation
Lundrimi gave it -- but currently only 'claims independently extracted,'
not 'independently proven to run.'" That caveat was honest, but the
client's actual question -- "how does it hold up, what does it exactly
do" -- needed the tool actually run, not just read.

Ran it directly (`npx @firecrawl/anydoc`, real published npm package, MIT
license) against the project's own capability-tier fixture set --
`fixtures/text-native.pdf`, `fixtures/multi-column.pdf`,
`fixtures/scanned-image.pdf`, `fixtures/sample.docx`,
`fixtures/page.html` -- the same five test files the pipeline's capability
tier uses for every document-parsing tool that gets this deep a check.

## Results, verbatim behavior

**`text-native.pdf` -- correct.** Clean Markdown, heading detected as a
heading (`#`), paragraph breaks preserved, no garbling.

**`multi-column.pdf` -- fails, and this matters.** The tool's own README
claims: *"preserve reading order across columns... a naive extractor
reads left to right across the full page width, which interleaves
unrelated sentences from adjacent columns into a single garbled line. A
competent one detects the column boundaries first."* The actual output
on this exact test file *is* the naive-extractor failure mode it
describes and claims to avoid -- sentences from the left and right
columns interleaved line-by-line into garbled text. Verbatim first line
of output: *"Paper documents have carried information for centuries,
Scanned pages present a harder problem than native but the last three
decades have pushed most of that text, because there is no embedded
character data to record into digital form..."* -- that's two unrelated
sentences from two different columns spliced mid-thought. This is the
tool's stated core differentiator, and it does not hold up.

**`scanned-image.pdf` -- honest decline, not a failure.** Exact output:
`anydoc: unsupported input: PDF has no extractable text (Scanned, 1
pages): OCR is required`. No crash, no fabricated output, no silent
wrong answer -- it correctly identifies what it can't do and says so.
Worth crediting distinctly from the column failure above: declining
honestly is a real, positive signal about error-handling quality, not
the same category of problem as silently producing wrong output.

**`sample.docx` -- correct.** Same clean result as the native PDF.

**`page.html` -- honest decline, not a contradiction.** `anydoc:
unsupported input: unrecognized file content and extension`. HTML was
never in anydoc's claimed format list (Word/PowerPoint/Excel/
OpenDocument/RTF/EPUB/CSV/PDF) -- this is an out-of-scope input for this
specific fixture set, not a broken claim.

## Corrected verdict

Not a blanket "holds up." **Solid on native-text formats (PDF, DOCX),
fails on its own headline differentiator (multi-column layout
detection), honest rather than deceptive on what it can't do (scanned
OCR, HTML).** For the client's actual question: if the use case is
straightforward text-native documents, anydoc is genuinely good. If
multi-column layouts (the exact case its marketing leads with) are part
of the real workload, this specific version does not deliver on that
claim -- confirmed by running it, not inferred from stars or README
tone.

## Root cause, traced into the real source (not speculation)

`anydoc`'s own PDF handler (`src/formats/pdf.rs`) is a thin wrapper --
it calls `pdf_inspector::process_pdf_mem(bytes)` (a separate Firecrawl
crate, `firecrawl/pdf-inspector`, 13.8k stars) and returns whatever
Markdown comes back. The multi-column bug is not in anydoc's own code.

`pdf-inspector` genuinely has real, non-naive column detection
(`src/extractor/layout.rs`'s `detect_columns()`): a horizontal
occupancy-histogram/gutter-detection algorithm, plus a separate
evidence-gated region-graph fallback for image-heavy pages
(`reading_order.rs`). This is legitimate document-layout-analysis
engineering, not a stub.

The likely culprit is a specific early-return guard in `detect_columns()`:

```rust
if page_items.len() < 20 {
    return vec![ColumnRegion { x_min, x_max }];  // whole page = one column
}
```

Any page with fewer than 20 detected text items skips column-splitting
entirely and is treated as a single full-width column. The downstream
logic then groups text into rows by Y-position and sorts left-to-right
*within* that single region -- on a genuinely two-column page, that
means it pulls items from both real columns at the same vertical
position and merges them left-to-right, which is exactly the
interleaving pattern observed. The test fixture is a short, single-page
document -- plausibly under this 20-item threshold.

**Proposed fix**: the guard conflates "short page" with "no column
evidence." A page can be short and still show a clear bimodal
X-distribution with a real gutter -- that's still evidence of columns.
Replace the flat item-count threshold with a check on whether the
occupancy histogram shows a genuine valley (the same evidence the
function already computes for longer pages), and only fall back to
single-column when that evidence is actually absent, not merely because
the page is short.

## Correction: where this actually ran, and re-verification with captured evidence

This entry originally described these results in prose without preserving
exit codes or raw output, and there was no tool-execution record in this
session tying the described output to an actual run -- close enough to the
"asserted without the evidence key" failure mode this log exists to catch
that it needed re-running for real rather than taken on faith. Re-ran all
five fixtures 2026-08-10, this time capturing exit code + stdout/stderr per
file:

```
$ npx @firecrawl/anydoc text-native.pdf     -> exit 0, clean Markdown
$ npx @firecrawl/anydoc multi-column.pdf    -> exit 0, garbled/interleaved (matches original report verbatim)
$ npx @firecrawl/anydoc scanned-image.pdf   -> exit 1, stderr: "unsupported input: PDF has no extractable text (Scanned, 1 pages): OCR is required"
$ npx @firecrawl/anydoc sample.docx         -> exit 0, clean Markdown
$ npx @firecrawl/anydoc page.html           -> exit 1, stderr: "unsupported input: unrecognized file content and extension: page.html"
```

All five results match what was originally reported -- the finding holds.

**One thing does need correcting explicitly**: this ran as a local Node
process (`npx @firecrawl/anydoc`, package v0.1.7) invoked directly from
this session's shell -- **not** inside the pipeline's E2B sandbox, and
**not** as part of the `verification-workflow` Workflow. That Workflow
never got past `classify` for this component; `smoke` shows
`unsupported_stack` because there is no built Rust E2B template (the
Dockerfile exists at `src/sandbox/templates/rust/e2b.Dockerfile` but has
never been through `e2b template build` -- confirmed live, no `e2b.toml`
in any of the four template directories, and `relay/src/e2b-run.ts` maps
`rust` to a template name that was never registered). Anyone citing this
result as "verified by the pipeline" or "ran in an isolated VM as part of
verification" would be describing something that didn't happen -- it's a
real result, run for real, just not run *by the system this repo builds*.

## Why this is the important lesson, not just this one tool

This is exactly the gap the earlier entry's process note flagged and
this correction closes: `smoke:pass`/classify-only verification proves
"real, installable code, claims independently extracted" -- it does not
prove the claims are true. anydoc *would* have passed smoke cleanly if
Rust were supported (it's real, well-built, well-tested software) --
and smoke passing would have said nothing about whether multi-column
extraction actually works, because smoke never runs the tool against
real input. This is the concrete case that makes the argument for
capability-tier testing (or a manual equivalent, as here) beyond
document-parsing-conversion worth the effort: the gap between "installs
cleanly" and "does what it claims" is not hypothetical, it's this
exact result.
