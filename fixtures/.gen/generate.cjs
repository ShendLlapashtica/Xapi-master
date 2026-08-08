const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { createCanvas } = require("@napi-rs/canvas");
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TextRun,
} = require("docx");
const { PARAGRAPHS, fullText, wordCount } = require("./content.cjs");

const OUT_DIR = path.join(__dirname, "..");

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function makeTextNativePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  const margin = 56;
  let y = 792 - margin;

  page.drawText("Document Extraction: A Short Overview", {
    x: margin,
    y,
    size: 18,
    font: boldFont,
  });
  y -= 34;

  for (const para of PARAGRAPHS) {
    const lines = wrapText(para, font, 11, 612 - margin * 2);
    for (const line of lines) {
      if (y < margin) {
        page = doc.addPage([612, 792]);
        y = 792 - margin;
      }
      page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0, 0, 0) });
      y -= 15;
    }
    y -= 12;
  }

  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT_DIR, "text-native.pdf"), bytes);
  console.log("text-native.pdf written,", bytes.length, "bytes");
}

async function makeScannedImagePdf() {
  // Render the first two paragraphs as a rasterized image -- no embedded
  // text layer at all, so only real OCR can recover anything from it.
  const width = 1200;
  const height = 1600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("Scanned Page Sample", 60, 80);

  ctx.font = "22px sans-serif";
  const margin = 60;
  const maxWidth = width - margin * 2;
  let y = 140;
  for (const para of PARAGRAPHS.slice(0, 2)) {
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        ctx.fillText(line, margin, y);
        y += 32;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ctx.fillText(line, margin, y);
      y += 32;
    }
    y += 20;
  }

  const pngBytes = canvas.toBuffer("image/png");

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(pngBytes);
  const page = doc.addPage([width / 2, height / 2]); // points ~= px/2 at 144dpi-ish scale
  page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });
  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT_DIR, "scanned-image.pdf"), bytes);
  console.log("scanned-image.pdf written,", bytes.length, "bytes (image-only, no text layer)");
}

async function makeMultiColumnPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const margin = 48;
  const gutter = 20;
  const colWidth = (612 - margin * 2 - gutter) / 2;
  const colXs = [margin, margin + colWidth + gutter];

  page.drawText("Multi-Column Layout Sample", { x: margin, y: 792 - 40, size: 16, font: boldFont });

  const left = [PARAGRAPHS[0], PARAGRAPHS[1]].join(" ");
  const right = [PARAGRAPHS[2], PARAGRAPHS[3]].join(" ");
  [left, right].forEach((text, i) => {
    let y = 792 - 80;
    const lines = wrapText(text, font, 10, colWidth);
    for (const line of lines) {
      page.drawText(line, { x: colXs[i], y, size: 10, font });
      y -= 14;
    }
  });

  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT_DIR, "multi-column.pdf"), bytes);
  console.log("multi-column.pdf written,", bytes.length, "bytes");
}

async function makeDocx() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Document Extraction: A Short Overview", heading: HeadingLevel.HEADING_1 }),
          ...PARAGRAPHS.map((p) => new Paragraph({ children: [new TextRun(p)] })),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, "sample.docx"), buf);
  console.log("sample.docx written,", buf.length, "bytes");
}

function makeHtml() {
  const rows = [
    ["Tool class", "Handles scans", "Preserves column order"],
    ["Plain text extractor", "No", "No"],
    ["Layout-aware parser", "No", "Yes"],
    ["OCR pipeline", "Yes", "Depends"],
  ];
  const tableRows = rows
    .map((r, i) => `<tr>${r.map((c) => `<t${i === 0 ? "h" : "d"}>${c}</t${i === 0 ? "h" : "d"}>`).join("")}</tr>`)
    .join("\n");
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Document Extraction: A Short Overview</title></head>
<body>
<h1>Document Extraction: A Short Overview</h1>
${PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n")}
<h2>Tool comparison</h2>
<table>
${tableRows}
</table>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT_DIR, "page.html"), html, "utf-8");
  console.log("page.html written,", Buffer.byteLength(html), "bytes");
}

(async () => {
  await makeTextNativePdf();
  await makeScannedImagePdf();
  await makeMultiColumnPdf();
  await makeDocx();
  makeHtml();

  console.log("\nTrue word count of source prose:", wordCount(fullText()));
  console.log("Source prose (all 4 paragraphs) word count:", wordCount(PARAGRAPHS.join(" ")));
  console.log("First 2 paragraphs (scanned image) word count:", wordCount(PARAGRAPHS.slice(0, 2).join(" ")));
})();
