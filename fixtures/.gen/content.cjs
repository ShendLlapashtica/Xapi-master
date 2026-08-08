// Real, original prose used across the fixtures -- not lorem ipsum, not
// copied from anywhere, so word counts and content are exactly known.
const PARAGRAPHS = [
  "Paper documents have carried information for centuries, but the last three decades have pushed most of that record into digital form. Converting a scanned page or a legacy file into structured text is a small task in isolation, yet it sits underneath search engines, archives, and every pipeline that needs to reason about what a document actually says rather than just where it is stored.",
  "A text extraction tool is judged by more than whether it runs without crashing. It has to preserve reading order across columns, recognize headings as headings rather than as ordinary paragraphs, and produce output that a downstream system can actually use. Many tools clear the first bar and fail the second, which is why word count alone is a weak signal of quality.",
  "Scanned pages present a harder problem than native text, because there is no embedded character data to read directly. Whatever text comes out has to be recognized from pixels, and recognition quality depends heavily on scan resolution, contrast, and font choice. A tool that handles native PDFs well may still produce nothing usable when handed a scan of the same page.",
  "Multi-column layouts are a common failure point. A naive extractor reads left to right across the full page width, which interleaves unrelated sentences from adjacent columns into a single garbled line. A competent one detects the column boundaries first and reads each column top to bottom before moving to the next, preserving the sentence order a human reader would expect.",
];

function fullText() {
  return PARAGRAPHS.join("\n\n");
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

module.exports = { PARAGRAPHS, fullText, wordCount };
