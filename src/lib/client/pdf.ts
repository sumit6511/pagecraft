"use client";

import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { ToolError, baseName, parsePageGroups, parsePageSet } from "../pages";
import { decodeImage, readJpegOrientation } from "./images";
import type { Output } from "./types";

const PDF = "application/pdf";

export async function loadPdf(file: File | Uint8Array, label = "This file") {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/encrypt/i.test(msg)) {
      throw new ToolError(`${label} is password-protected. Remove the password with Unlock PDF first.`);
    }
    throw new ToolError(`${label} couldn't be read as a PDF. It may be damaged or not a PDF.`);
  }
}

async function save(doc: PDFDocument, name: string): Promise<Output> {
  const bytes = await doc.save({ useObjectStreams: true });
  return { name, blob: new Blob([bytes as BlobPart], { type: PDF }) };
}

/** Copy the given 0-based pages of `src` into a fresh document. */
async function subset(src: PDFDocument, indices: number[]) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

// ── Coordinates in the page's *visible* orientation ────────────────────────
// A page with /Rotate is displayed rotated clockwise, but drawing happens in
// its unrotated space. These helpers let callers think in what the reader
// sees (origin bottom-left of the visible page) and map to drawing space.

function visualSize(page: PDFPage) {
  const { width, height } = page.getSize();
  const r = norm(page.getRotation().angle);
  return r === 90 || r === 270 ? { w: height, h: width, r } : { w: width, h: height, r };
}

function toPageSpace(page: PDFPage, vx: number, vy: number) {
  const { width: W, height: H } = page.getSize();
  switch (norm(page.getRotation().angle)) {
    case 90:
      return { x: W - vy, y: vx };
    case 180:
      return { x: W - vx, y: H - vy };
    case 270:
      return { x: vy, y: H - vx };
    default:
      return { x: vx, y: vy };
  }
}

type Corner = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right" | "center";

/** Bottom-left origin (visible space) for a box of size bw×bh at a named spot. */
function anchor(pos: Corner, vw: number, vh: number, bw: number, bh: number, margin: number) {
  const [v, hz] = pos === "center" ? ["middle", "center"] : pos.split("-");
  const x = hz === "left" ? margin : hz === "right" ? vw - margin - bw : (vw - bw) / 2;
  const y = v === "bottom" ? margin : v === "top" ? vh - margin - bh : (vh - bh) / 2;
  return { x, y };
}

/** Draw upright text whose visible bottom-left is at (vx, vy), rotated `angle` degrees CCW. */
function drawVisualText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  vx: number,
  vy: number,
  opts: { angle?: number; color: ReturnType<typeof rgb>; opacity?: number },
) {
  const { r } = visualSize(page);
  const { x, y } = toPageSpace(page, vx, vy);
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: opts.color,
    opacity: opts.opacity ?? 1,
    rotate: degrees(r + (opts.angle ?? 0)),
  });
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard fonts only cover WinAnsi; reject text they can't encode up front. */
function assertEncodable(font: PDFFont, text: string) {
  try {
    font.encodeText(text);
  } catch {
    throw new ToolError("The text contains characters the built-in font can't draw. Use Latin letters, digits and common punctuation.");
  }
}

// ── Tools ──────────────────────────────────────────────────────────────────

export async function mergePdfs(files: File[]): Promise<Output[]> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const src = await loadPdf(file, `"${file.name}"`);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return [await save(out, "merged.pdf")];
}

export async function splitPdf(file: File, o: Record<string, string>): Promise<Output[]> {
  const src = await loadPdf(file);
  const total = src.getPageCount();
  const base = baseName(file.name);
  let groups: number[][];
  if (o.mode === "every") {
    groups = src.getPageIndices().map((i) => [i]);
  } else if (o.mode === "chunks") {
    const n = Math.max(1, Math.floor(Number(o.chunk) || 1));
    groups = [];
    for (let i = 0; i < total; i += n) {
      groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    }
  } else {
    groups = parsePageGroups(o.ranges ?? "", total);
  }
  const outputs: Output[] = [];
  for (const g of groups) {
    const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
    outputs.push(await save(await subset(src, g), `${base}_p${label}.pdf`));
  }
  return outputs;
}

export async function rotatePdf(files: File[], o: Record<string, string>): Promise<Output[]> {
  const add = Number(o.angle) || 90;
  const outputs: Output[] = [];
  for (const file of files) {
    const doc = await loadPdf(file, `"${file.name}"`);
    const pages = doc.getPages();
    for (const i of parsePageSet(o.pages ?? "", pages.length)) {
      pages[i].setRotation(degrees(norm(pages[i].getRotation().angle + add)));
    }
    outputs.push(await save(doc, `${baseName(file.name)}_rotated.pdf`));
  }
  return outputs;
}

export async function removePages(file: File, o: Record<string, string>): Promise<Output[]> {
  const src = await loadPdf(file);
  const total = src.getPageCount();
  const drop = new Set(parsePageSet(o.pages ?? "", total));
  const keep = src.getPageIndices().filter((i) => !drop.has(i));
  if (keep.length === 0) throw new ToolError("That would remove every page. Leave at least one.");
  return [await save(await subset(src, keep), `${baseName(file.name)}_edited.pdf`)];
}

export async function extractPages(file: File, o: Record<string, string>): Promise<Output[]> {
  const src = await loadPdf(file);
  // Keep the order the user typed (e.g. "5, 1-2"), without duplicates.
  const order = [...new Set(parsePageGroups(o.pages ?? "", src.getPageCount()).flat())];
  return [await save(await subset(src, order), `${baseName(file.name)}_extracted.pdf`)];
}

export interface OrganizeItem {
  /** 0-based index in the source document. */
  index: number;
  /** Extra clockwise rotation to apply, in degrees. */
  rotate: number;
}

export async function organizePdf(file: File, plan: OrganizeItem[]): Promise<Output[]> {
  if (plan.length === 0) throw new ToolError("Keep at least one page.");
  const src = await loadPdf(file);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, plan.map((p) => p.index));
  pages.forEach((p, i) => {
    p.setRotation(degrees(norm(p.getRotation().angle + plan[i].rotate)));
    out.addPage(p);
  });
  return [await save(out, `${baseName(file.name)}_organized.pdf`)];
}

export async function watermarkPdf(files: File[], o: Record<string, string>): Promise<Output[]> {
  const text = (o.text ?? "").trim();
  if (!text) throw new ToolError("Enter the watermark text.");
  const size = Number(o.size) || 56;
  const opacity = (Number(o.opacity) || 25) / 100;
  const color = hexToRgb(o.color ?? "#d92d20");
  const outputs: Output[] = [];
  for (const file of files) {
    const doc = await loadPdf(file, `"${file.name}"`);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    assertEncodable(font, text);
    const tw = font.widthOfTextAtSize(text, size);
    const th = font.heightAtSize(size, { descender: false });
    const pages = doc.getPages();
    for (const i of parsePageSet(o.pages ?? "", pages.length)) {
      const page = pages[i];
      const { w, h } = visualSize(page);
      if (o.position === "diagonal") {
        const angle = (Math.atan2(h, w) * 180) / Math.PI;
        const rad = (angle * Math.PI) / 180;
        // Offset the origin so the text's center sits at the page center.
        const vx = w / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2;
        const vy = h / 2 - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * th) / 2;
        drawVisualText(page, text, font, size, vx, vy, { angle, color, opacity });
      } else {
        const p = anchor(o.position as Corner, w, h, tw, th, 28);
        drawVisualText(page, text, font, size, p.x, p.y, { color, opacity });
      }
    }
    outputs.push(await save(doc, `${baseName(file.name)}_watermarked.pdf`));
  }
  return outputs;
}

export async function addPageNumbers(files: File[], o: Record<string, string>): Promise<Output[]> {
  const size = Number(o.size) || 11;
  const start = Math.floor(Number(o.start)) || 0;
  const skipFirst = o.skipFirst === "true";
  const outputs: Output[] = [];
  for (const file of files) {
    const doc = await loadPdf(file, `"${file.name}"`);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const numbered = skipFirst ? pages.slice(1) : pages;
    const last = start + numbered.length - 1;
    numbered.forEach((page, i) => {
      const n = start + i;
      const label =
        o.format === "page-n"
          ? `Page ${n}`
          : o.format === "n-of-total"
            ? `${n} / ${last}`
            : o.format === "page-n-of-total"
              ? `Page ${n} of ${last}`
              : `${n}`;
      const { w, h } = visualSize(page);
      const tw = font.widthOfTextAtSize(label, size);
      const p = anchor(o.position as Corner, w, h, tw, size * 0.72, 24);
      drawVisualText(page, label, font, size, p.x, p.y, { color: rgb(0.15, 0.15, 0.15) });
    });
    outputs.push(await save(doc, `${baseName(file.name)}_numbered.pdf`));
  }
  return outputs;
}

export interface SignPlacement {
  pageIndex: number;
  /** Box in fractions of the visible page, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG data URL of the signature. */
  png: string;
}

export async function signPdf(file: File, placements: SignPlacement[]): Promise<Output[]> {
  if (placements.length === 0) throw new ToolError("Place your signature on a page first.");
  const doc = await loadPdf(file);
  const pages = doc.getPages();
  const cache = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const pl of placements) {
    const page = pages[pl.pageIndex];
    if (!page) continue;
    let img = cache.get(pl.png);
    if (!img) {
      img = await doc.embedPng(pl.png);
      cache.set(pl.png, img);
    }
    const { w: vw, h: vh, r } = visualSize(page);
    const bw = pl.w * vw;
    const bh = pl.h * vh;
    const vx = pl.x * vw;
    const vy = vh - (pl.y * vh + bh); // top-left fractions → bottom-left points
    const { x, y } = toPageSpace(page, vx, vy);
    page.drawImage(img, { x, y, width: bw, height: bh, rotate: degrees(r) });
  }
  return [await save(doc, `${baseName(file.name)}_signed.pdf`)];
}

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(files: File[], o: Record<string, string>): Promise<Output[]> {
  const doc = await PDFDocument.create();
  const margin = Number(o.margin) || 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    let img;
    if (isJpeg && readJpegOrientation(bytes) <= 1) {
      img = await doc.embedJpg(bytes);
    } else if (isPng) {
      img = await doc.embedPng(bytes);
    } else {
      // WebP/GIF/BMP, or a JPEG that relies on EXIF rotation: let the browser
      // decode it upright, then re-encode as something PDF can embed.
      const { canvas } = await decodeImage(file);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new ToolError(`"${file.name}" couldn't be converted.`);
      img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    }
    let pw: number, ph: number;
    if (o.size === "a4" || o.size === "letter") {
      const [sw, sh] = PAGE_SIZES[o.size];
      const landscape = o.orientation === "landscape" || (o.orientation === "auto" && img.width > img.height);
      [pw, ph] = landscape ? [sh, sw] : [sw, sh];
    } else {
      pw = img.width + margin * 2;
      ph = img.height + margin * 2;
    }
    const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf";
  return [await save(doc, name)];
}
