"use client";

import { ToolError, baseName } from "../pages";
import { canvasToBlob } from "./render";
import type { Output } from "./types";

type Format = "jpg" | "png" | "webp";
const MIME: Record<Format, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
// Browsers refuse canvases much bigger than this (Safari caps at ~16.7M px).
const MAX_PIXELS = 16_000_000;

function formatOf(file: File): Format | null {
  const n = file.name.toLowerCase();
  if (file.type === "image/jpeg" || /\.jpe?g$/.test(n)) return "jpg";
  if (file.type === "image/png" || n.endsWith(".png")) return "png";
  if (file.type === "image/webp" || n.endsWith(".webp")) return "webp";
  return null;
}

/** Decode an image upright (EXIF orientation applied) onto a canvas. */
export async function decodeImage(file: File, width?: number, height?: number) {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ToolError(`"${file.name}" couldn't be opened as an image.`);
  }
  const w = Math.max(1, Math.round(width ?? bmp.width));
  const h = Math.max(1, Math.round(height ?? bmp.height));
  if (w * h > MAX_PIXELS) {
    bmp.close();
    throw new ToolError(`"${file.name}" would be ${w}×${h} px, which is larger than browsers can process.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const natural = { width: bmp.width, height: bmp.height };
  bmp.close();
  return { canvas, natural };
}

/** Encode a canvas; JPG gets a white background since it has no alpha. */
async function encode(canvas: HTMLCanvasElement, format: Format, quality?: number) {
  let src = canvas;
  if (format === "jpg") {
    src = document.createElement("canvas");
    src.width = canvas.width;
    src.height = canvas.height;
    const ctx = src.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, src.width, src.height);
    ctx.drawImage(canvas, 0, 0);
  }
  const blob = await canvasToBlob(src, MIME[format], quality);
  // Some browsers silently fall back to PNG for unsupported types.
  if (blob.type !== MIME[format]) {
    throw new ToolError(`Your browser can't create ${format.toUpperCase()} files. Try another format.`);
  }
  return blob;
}

const ext = (f: Format) => (f === "jpg" ? "jpg" : f);

export async function compressImages(files: File[], o: Record<string, string>): Promise<Output[]> {
  const q = Math.min(0.95, Math.max(0.1, (Number(o.quality) || 70) / 100));
  const out: Output[] = [];
  for (const file of files) {
    const src = formatOf(file);
    const target: Format =
      o.format === "jpg" || o.format === "webp"
        ? o.format
        : src === "jpg" || src === "webp"
          ? src
          : src === "png"
            ? "webp"
            : "jpg";
    const { canvas } = await decodeImage(file);
    const blob = await encode(canvas, target, q);
    if (blob.size >= file.size) {
      out.push({ name: file.name, blob: file, note: "Already well compressed; kept the original." });
    } else {
      out.push({ name: `${baseName(file.name)}_compressed.${ext(target)}`, blob });
    }
  }
  return out;
}

export async function resizeImages(files: File[], o: Record<string, string>): Promise<Output[]> {
  const out: Output[] = [];
  for (const file of files) {
    const probe = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    if (!probe) throw new ToolError(`"${file.name}" couldn't be opened as an image.`);
    const { width: nw, height: nh } = probe;
    probe.close();
    let w: number, h: number;
    if (o.mode === "pixels") {
      w = Math.max(1, Number(o.width) || nw);
      const reqH = Number(o.height) || 0;
      h = reqH > 0 ? reqH : Math.round((nh * w) / nw);
    } else {
      const s = (Number(o.percent) || 50) / 100;
      w = nw * s;
      h = nh * s;
    }
    const { canvas } = await decodeImage(file, w, h);
    const f = formatOf(file) ?? "png";
    out.push({ name: `${baseName(file.name)}_${canvas.width}x${canvas.height}.${ext(f)}`, blob: await encode(canvas, f, 0.92) });
  }
  return out;
}

export async function convertImages(files: File[], o: Record<string, string>): Promise<Output[]> {
  const f = (["jpg", "png", "webp"].includes(o.format) ? o.format : "png") as Format;
  const out: Output[] = [];
  for (const file of files) {
    const { canvas } = await decodeImage(file);
    out.push({ name: `${baseName(file.name)}.${ext(f)}`, blob: await encode(canvas, f, 0.92) });
  }
  return out;
}

export interface CropRect {
  /** In natural (upright) image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function cropImage(file: File, r: CropRect): Promise<Output[]> {
  if (r.w < 1 || r.h < 1) throw new ToolError("Select an area to keep first.");
  const { canvas: full } = await decodeImage(file);
  const c = document.createElement("canvas");
  c.width = Math.round(r.w);
  c.height = Math.round(r.h);
  c.getContext("2d")!.drawImage(full, Math.round(r.x), Math.round(r.y), c.width, c.height, 0, 0, c.width, c.height);
  const f = formatOf(file) ?? "png";
  return [{ name: `${baseName(file.name)}_cropped.${ext(f)}`, blob: await encode(c, f, 0.95) }];
}

// ── Lossless metadata stripping ────────────────────────────────────────────

/** EXIF orientation of a JPEG (1 = upright, or unknown). */
export function readJpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) break; // start of scan: no more headers
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif") {
      const t = i + 10; // TIFF header
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2)) >>> 0;
      const ifd = t + u32(t + 4);
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xda) {
      parts.push(b.subarray(i)); // scan data to end of file
      return concat(parts);
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe1 && marker <= 0xef; // APP1..APP15 (EXIF, XMP, IPTC…)
    const isIcc = marker === 0xe2 && String.fromCharCode(...seg.subarray(4, 15)) === "ICC_PROFILE";
    const isComment = marker === 0xfe;
    if ((!isApp || isIcc) && !isComment) parts.push(seg); // keep colour profile
    i += 2 + len;
  }
  return null;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!drop.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (end > b.length + 1) return null;
    const t = tag(i);
    if (t !== "EXIF" && t !== "XMP ") {
      const c = b.slice(i, Math.min(end, b.length));
      if (t === "VP8X") c[8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
      chunks.push(c);
    }
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  const size = body.length + 4;
  header.set([size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255], 4);
  return concat([header, body]);
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function removeMetadata(files: File[]): Promise<Output[]> {
  const out: Output[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const f = formatOf(file);
    let clean: Uint8Array | null = null;
    let note: string | undefined;
    if (f === "jpg") {
      // Dropping EXIF would also drop the rotation flag, so bake it in.
      if (readJpegOrientation(bytes) > 1) {
        const { canvas } = await decodeImage(file);
        clean = new Uint8Array(await (await encode(canvas, "jpg", 0.95)).arrayBuffer());
        note = "Re-encoded at high quality to keep the photo upright.";
      } else clean = stripJpeg(bytes);
    } else if (f === "png") clean = stripPng(bytes);
    else if (f === "webp") clean = stripWebp(bytes);
    if (!clean) throw new ToolError(`"${file.name}" has an unexpected structure and wasn't changed.`);
    out.push({
      name: `${baseName(file.name)}_clean.${f === "jpg" ? "jpg" : f}`,
      blob: new Blob([clean as BlobPart], { type: file.type || MIME[f!] }),
      note,
    });
  }
  return out;
}
