# Capability-tier fixtures

Five hand-picked inputs for the `document-parsing-conversion` capability
harness (BRIEF.md §2). Expected-profile metadata (min word count, expected
structural elements) lives in [`../seed/fixtures.manifest.json`](../seed/fixtures.manifest.json)
and is bundled straight into the Worker; these binary files are not --
they're uploaded to R2 directly and read at verification time by
`src/verify/steps/capability.ts`.

| File | Fixture ID | What it's testing |
|---|---|---|
| `text-native.pdf` | `text-native-pdf` | Baseline: a PDF with a real text layer, no OCR needed |
| `scanned-image.pdf` | `scanned-image-pdf` | A scanned/image-only PDF -- needs OCR to extract anything |
| `multi-column.pdf` | `multi-column-pdf` | Multi-column layout, checks the converter doesn't interleave columns and preserves headings |
| `sample.docx` | `docx` | A Word document with at least one heading |
| `page.html` | `html` | An HTML page containing a `<table>` |

None of these five files are checked into this repo (binary fixtures don't
belong in git history, and there's no canonical source to fetch them from
here without picking specific copyrighted/licensed documents on the user's
behalf). Pick your own five documents matching the table above, place them
in this directory using the exact filenames listed, then upload:

```bash
wrangler r2 object put xapi-evidence/fixtures/text-native.pdf --file fixtures/text-native.pdf
wrangler r2 object put xapi-evidence/fixtures/scanned-image.pdf --file fixtures/scanned-image.pdf
wrangler r2 object put xapi-evidence/fixtures/multi-column.pdf --file fixtures/multi-column.pdf
wrangler r2 object put xapi-evidence/fixtures/sample.docx --file fixtures/sample.docx
wrangler r2 object put xapi-evidence/fixtures/page.html --file fixtures/page.html
```

If `seed/fixtures.manifest.json`'s `minWordCount`/`expectedStructures`
don't match the actual documents you pick, adjust that file to match --
it's the source of truth `fixture-outcome.ts` scores against.
