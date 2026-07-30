/**
 * Zero-dependency PDF receipt/invoice generator.
 *
 * We only ever need clean typographic receipts (headline, meta rows, a line
 * item table and a total), so instead of shipping a 400kb PDF library we
 * emit the PDF by hand: two Helvetica fonts, one page, one content stream.
 * Runs entirely in the browser and returns a Blob you can download.
 */

type Row = { label: string; value: string };

export type ReceiptDoc = {
  /** "INVOICE" or "RECEIPT" */
  kind: "RECEIPT" | "INVOICE";
  /** Human reference shown large under the title. */
  number: string;
  issuedAt: string; // ISO
  billedTo: string;
  status: string;
  meta: Row[];
  lineItem: { description: string; detail?: string; amount: string };
  total: string;
  /** Optional footer note, wrapped automatically. */
  note?: string;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

/** PDF strings are latin-1; strip anything exotic so offsets stay byte-exact. */
function ascii(input: string): string {
  return (input ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00b7/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
}

function esc(s: string): string {
  return ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Rough Helvetica width table is overkill — 0.5em average is close enough. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const perChar = size * 0.5;
  const max = Math.max(8, Math.floor(maxWidth / perChar));
  const words = ascii(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

class Content {
  private ops: string[] = [];

  text(x: number, y: number, str: string, size: number, bold = false, gray = 0) {
    this.ops.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${x.toFixed(2)} ${y.toFixed(
        2,
      )} Td (${esc(str)}) Tj ET`,
    );
  }

  rule(y: number, x1 = MARGIN, x2 = PAGE_W - MARGIN, gray = 0.85) {
    this.ops.push(
      `${gray} G 0.8 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`,
    );
  }

  rect(x: number, y: number, w: number, h: number, gray = 0.96) {
    this.ops.push(`${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  toString() {
    return this.ops.join("\n");
  }
}

function buildPdf(stream: string): Blob {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
  );
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

export function renderReceiptPdf(doc: ReceiptDoc): Blob {
  const c = new Content();
  const right = PAGE_W - MARGIN;
  let y = PAGE_H - MARGIN;

  // Header
  c.text(MARGIN, y, "Petal", 22, true);
  c.text(MARGIN, y - 16, "buildwithpetal.com", 9, false, 0.45);
  c.text(right - 90, y, doc.kind, 16, true, 0.35);
  c.text(right - 90, y - 16, `#${doc.number}`, 9, false, 0.45);
  y -= 40;
  c.rule(y);
  y -= 28;

  // Billed to / issued
  c.text(MARGIN, y, "BILLED TO", 8, true, 0.5);
  c.text(MARGIN, y - 14, doc.billedTo, 11);
  c.text(right - 200, y, "ISSUED", 8, true, 0.5);
  c.text(
    right - 200,
    y - 14,
    new Date(doc.issuedAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    11,
  );
  c.text(right - 200, y - 32, `Status: ${doc.status}`, 10, true, 0.25);
  y -= 58;

  // Line item block
  c.rect(MARGIN, y - 54, right - MARGIN, 54, 0.97);
  c.text(MARGIN + 14, y - 22, doc.lineItem.description, 12, true);
  if (doc.lineItem.detail) {
    c.text(MARGIN + 14, y - 38, doc.lineItem.detail, 9.5, false, 0.45);
  }
  c.text(right - 100, y - 22, doc.lineItem.amount, 12, true);
  y -= 78;

  // Total
  c.rule(y + 12);
  c.text(right - 190, y - 8, "TOTAL PAID", 9, true, 0.45);
  c.text(right - 100, y - 10, doc.total, 15, true);
  y -= 44;

  // Meta rows
  if (doc.meta.length) {
    c.text(MARGIN, y, "PAYMENT DETAILS", 8, true, 0.5);
    y -= 18;
    for (const row of doc.meta) {
      c.text(MARGIN, y, row.label, 9.5, false, 0.45);
      const valueLines = wrap(row.value, 9.5, right - (MARGIN + 150));
      valueLines.forEach((line, i) => {
        c.text(MARGIN + 150, y - i * 12, line, 9.5);
      });
      y -= Math.max(16, valueLines.length * 12 + 4);
    }
  }

  // Footer note
  y -= 10;
  c.rule(y);
  y -= 18;
  const note =
    doc.note ??
    "Thanks for building with Petal. This document was generated automatically and is valid without a signature.";
  for (const line of wrap(note, 9, right - MARGIN)) {
    c.text(MARGIN, y, line, 9, false, 0.45);
    y -= 12;
  }

  return buildPdf(c.toString());
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
