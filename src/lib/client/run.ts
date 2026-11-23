"use client";

import JSZip from "jszip";
import { ToolError, baseName, parsePageSet } from "../pages";
import type { ToolDef } from "../tools";
import {
  compressImages,
  convertImages,
  cropImage,
  removeMetadata,
  resizeImages,
  rotateImages,
  watermarkImages,
  type CropRect,
} from "./images";
import {
  addPageNumbers,
  cropPdf,
  editMetadata,
  extractPages,
  flattenPdf,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  pagesPerSheet,
  readMetadata,
  removePages,
  rotatePdf,
  signPdf,
  splitPdf,
  watermarkPdf,
  type OrganizeItem,
  type SignPlacement,
} from "./pdf";
import { canvasToBlob, openPdfForRender, renderPage } from "./render";
import type { Output } from "./types";

/** State produced by the visual editors (organize / sign / crop). */
export type EditorState =
  | { kind: "organize"; plan: OrganizeItem[] }
  | { kind: "sign"; placements: SignPlacement[] }
  | { kind: "crop"; rect: CropRect };

async function pdfToImages(file: File, o: Record<string, string>, onProgress?: (p: number) => void): Promise<Output[]> {
  const fmt = o.format === "png" ? "png" : o.format === "webp" ? "webp" : "jpg";
  const mime = fmt === "jpg" ? "image/jpeg" : `image/${fmt}`;
  const scale = (Number(o.dpi) || 150) / 72;
  const doc = await openPdfForRender(await file.arrayBuffer());
  try {
    const pages = parsePageSet(o.pages ?? "", doc.numPages);
    const out: Output[] = [];
    for (const [k, i] of pages.entries()) {
      const canvas = await renderPage(doc, i, scale);
      out.push({ name: `${baseName(file.name)}_page${i + 1}.${fmt}`, blob: await canvasToBlob(canvas, mime, 0.9) });
      canvas.width = canvas.height = 0; // free memory early on long documents
      onProgress?.((k + 1) / pages.length);
    }
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function pdfToText(files: File[], o: Record<string, string>, onProgress?: (p: number) => void): Promise<Output[]> {
  const out: Output[] = [];
  for (const [fi, file] of files.entries()) {
    const doc = await openPdfForRender(await file.arrayBuffer());
    try {
      const pages = parsePageSet(o.pages ?? "", doc.numPages);
      const parts: string[] = [];
      for (const [k, i] of pages.entries()) {
        const page = await doc.getPage(i + 1);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          text += item.str + (item.hasEOL ? "\n" : "");
        }
        page.cleanup();
        parts.push(o.separators === "true" ? `──── Page ${i + 1} ────\n${text.trim()}` : text.trim());
        onProgress?.((fi + (k + 1) / pages.length) / files.length);
      }
      const body = parts.join("\n\n") + "\n";
      const empty = parts.every((p) => !p.replace(/──── Page \d+ ────/, "").trim());
      out.push({
        name: `${baseName(file.name)}.txt`,
        blob: new Blob([body], { type: "text/plain;charset=utf-8" }),
        note: empty ? "No text found. If this is a scan, run OCR PDF first." : undefined,
      });
    } finally {
      await doc.loadingTask.destroy();
    }
  }
  return out;
}

/** Options read from the chosen file, for tools marked `prefill`. */
export async function prefillOptions(tool: ToolDef, file: File): Promise<Record<string, string>> {
  if (tool.slug === "edit-metadata") return readMetadata(file);
  return {};
}

export async function runClientTool(
  tool: ToolDef,
  files: File[],
  opts: Record<string, string>,
  editor?: EditorState,
  onProgress?: (p: number) => void,
): Promise<Output[]> {
  const [first] = files;
  switch (tool.slug) {
    case "merge-pdf":
      return mergePdfs(files);
    case "split-pdf":
      return splitPdf(first, opts);
    case "organize-pdf":
      if (editor?.kind !== "organize") throw new ToolError("Arrange your pages first.");
      return organizePdf(first, editor.plan);
    case "rotate-pdf":
      return rotatePdf(files, opts);
    case "pages-per-sheet":
      return pagesPerSheet(first, opts);
    case "pdf-to-text":
      return pdfToText(files, opts, onProgress);
    case "rotate-image":
      return rotateImages(files, opts);
    case "watermark-image":
      return watermarkImages(files, opts);
    case "crop-pdf":
      return cropPdf(files, opts);
    case "flatten-pdf":
      return flattenPdf(files);
    case "edit-metadata":
      return editMetadata(first, opts);
    case "remove-pages":
      return removePages(first, opts);
    case "extract-pages":
      return extractPages(first, opts);
    case "pdf-to-image":
      return pdfToImages(first, opts, onProgress);
    case "image-to-pdf":
      return imagesToPdf(files, opts);
    case "compress-image":
      return compressImages(files, opts);
    case "resize-image":
      return resizeImages(files, opts);
    case "convert-image":
      return convertImages(files, opts);
    case "crop-image":
      if (editor?.kind !== "crop") throw new ToolError("Select an area to keep first.");
      return cropImage(first, editor.rect);
    case "remove-metadata":
      return removeMetadata(files);
    case "watermark-pdf":
      return watermarkPdf(files, opts);
    case "page-numbers":
      return addPageNumbers(files, opts);
    case "sign-pdf":
      if (editor?.kind !== "sign") throw new ToolError("Place your signature on a page first.");
      return signPdf(first, editor.placements);
    default:
      throw new Error(`No browser implementation for ${tool.slug}`);
  }
}

/** Send files to the server-side tool endpoint and unpack the result. */
export async function runServerTool(tool: ToolDef, files: File[], opts: Record<string, string>, signal?: AbortSignal): Promise<Output[]> {
  const body = new FormData();
  files.forEach((f) => body.append("files", f, f.name));
  body.append("options", JSON.stringify(opts));
  let res: Response;
  try {
    res = await fetch(`/api/tools/${tool.slug}`, { method: "POST", body, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ToolError("Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ToolError(data?.error ?? `The server couldn't process this (error ${res.status}).`);
  }
  const blob = await res.blob();
  const name = decodeFilename(res.headers.get("content-disposition")) ?? "result";
  const notes: string[] = JSON.parse(res.headers.get("x-notes") ?? "[]");
  if (res.headers.get("x-bundle") !== "1") return [{ name, blob, note: notes[0] }];

  // Several outputs arrive as one zip; unpack them so each can be downloaded.
  const zip = await JSZip.loadAsync(blob);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  return Promise.all(
    entries.map(async (e, i) => ({
      name: e.name,
      blob: new Blob([await e.async("uint8array") as BlobPart], { type: guessType(e.name) }),
      note: notes[i] || undefined,
    })),
  );
}

function decodeFilename(header: string | null) {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

function guessType(name: string) {
  const e = name.split(".").pop()?.toLowerCase();
  return e === "pdf"
    ? "application/pdf"
    : e === "txt"
      ? "text/plain;charset=utf-8"
    : e === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/octet-stream";
}

export async function zipOutputs(outputs: Output[]) {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const o of outputs) {
    let name = o.name;
    for (let n = 2; used.has(name); n++) name = o.name.replace(/(\.[^.]+)?$/, `_${n}$1`);
    used.add(name);
    zip.file(name, o.blob);
  }
  return zip.generateAsync({ type: "blob" });
}
