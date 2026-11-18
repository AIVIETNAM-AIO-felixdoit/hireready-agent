export const MAX_CV_BYTES = 5 * 1024 * 1024;

type Kind = "pdf" | "docx" | "text";

function detectKind(file: File): Kind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  if (/\.(txt|md|markdown)$/.test(name)) return "text";
  return null;
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\t]+/g, " ")
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PdfTextItem = { str: string; transform: number[]; width: number; height: number };
type PdfLine = { text: string; x0: number; x1: number; y: number; h: number };

const BULLET = /^[•●○▪■◦‣∙·\-–*]|^\d+[.)]\s/;

function pageLines(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let cur: PdfLine | null = null;
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const h = item.height || Math.abs(item.transform[3]) || 10;
    if (!cur || Math.abs(y - cur.y) > Math.max(cur.h, h) * 0.5) {
      if (cur) lines.push(cur);
      cur = { text: item.str, x0: x, x1: x + item.width, y, h };
      continue;
    }
    const gap = x - cur.x1;
    if (gap > h * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(item.str)) cur.text += " ";
    cur.text += item.str;
    cur.x0 = Math.min(cur.x0, x);
    cur.x1 = Math.max(cur.x1, x + item.width);
    cur.h = Math.max(cur.h, h);
  }
  if (cur) lines.push(cur);
  return lines.filter((l) => l.text.trim());
}

function joinPdfLines(lines: PdfLine[]): string {
  if (!lines.length) return "";
  const left = Math.min(...lines.map((l) => l.x0));
  const right = Math.max(...lines.map((l) => l.x1));
  const out: string[] = [];
  let prev: PdfLine | null = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (prev) {
      const gap = prev.y - line.y;
      const lineStep = Math.max(prev.h, line.h) * 1.6;
      const prevFull = prev.x1 >= right - (right - left) * 0.12;
      const wrapped = gap > 0 && gap <= lineStep && prevFull && !BULLET.test(text) && line.x0 >= prev.x0 - 2;
      if (wrapped) {
        const last = out[out.length - 1];
        out[out.length - 1] = /[-‐]$/.test(last) && /^[a-z]/.test(text) ? last + text : `${last} ${text}`;
        prev = line;
        continue;
      }
      if (gap > lineStep * 1.3 || gap < 0) out.push("");
    }
    out.push(text);
    prev = line;
  }
  return out.join("\n");
}

async function extractPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => "str" in i) as PdfTextItem[];
      pages.push(joinPdfLines(pageLines(items)));
      page.cleanup();
    }
    return tidy(pages.join("\n\n"));
  } finally {
    await task.destroy();
  }
}

function cellText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function htmlToLines(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const lines: string[] = [];
  body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, tr").forEach((el) => {
    const outer = el.parentElement?.closest("li, tr");
    if (outer && !(el.tagName === "TR" && outer.tagName === "LI")) return;
    if (el.tagName === "TR") {
      const cells = Array.from(el.children).map(cellText).filter(Boolean);
      if (cells.length) lines.push(cells.join(" | "));
      return;
    }
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("ul, ol, table").forEach((n) => n.remove());
    const text = cellText(clone);
    if (!text) return;
    if (/^H[1-6]$/.test(el.tagName) && lines.length) lines.push("");
    if (el.tagName === "LI") {
      const ol = el.parentElement?.tagName === "OL";
      const n = ol ? Array.from(el.parentElement!.children).indexOf(el) + 1 : 0;
      lines.push(`${ol ? `${n}.` : "-"} ${text}`);
    } else {
      lines.push(text);
    }
  });
  return tidy(lines.join("\n"));
}

async function extractDocx(data: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data });
  const text = htmlToLines(html);
  if (text) return text;
  const { value: raw } = await mammoth.extractRawText({ arrayBuffer: data });
  return tidy(raw.replace(/\n{2,}/g, "\n"));
}

export async function extractCvText(file: File): Promise<string> {
  const kind = detectKind(file);
  if (!kind) throw new Error(`Unsupported file type "${file.name}". Upload a PDF, DOCX, TXT or MD file.`);
  if (file.size > MAX_CV_BYTES) {
    throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum CV file size is 5 MB.`);
  }
  if (kind === "text") return file.text();

  const data = await file.arrayBuffer();
  let text: string;
  try {
    text = kind === "pdf" ? await extractPdf(data) : await extractDocx(data);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new Error(`"${file.name}" is password-protected. Remove the password and try again.`);
    throw new Error(
      `Could not read "${file.name}". The file may be damaged or not a real ${kind.toUpperCase()}. Try another file or paste the text.`,
    );
  }
  if (text.replace(/\s/g, "").length < 20) {
    throw new Error(
      kind === "pdf"
        ? `No text found in "${file.name}". It looks like a scanned/image-only PDF. Upload a text-based PDF or DOCX, or paste the text.`
        : `No text found in "${file.name}". Paste the CV text directly instead.`,
    );
  }
  return text;
}
