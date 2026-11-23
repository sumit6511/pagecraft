"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Lazily load pdf.js so pages that never render PDFs don't pay for it. */
function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    // Copied into /public by scripts/copy-pdf-worker.mjs.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function openPdfForRender(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers the buffer to its worker, so give it a copy.
  const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  try {
    return await pdfjs.getDocument({ data: copy }).promise;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Unlock it first with the Unlock PDF tool.");
    }
    throw new Error("This file couldn't be read as a PDF. It may be damaged.");
  }
}

/** Render one page (0-based) to a canvas at the given scale (1 = 72 DPI). */
export async function renderPage(doc: PDFDocumentProxy, index: number, scale: number) {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  // White background so transparent pages don't turn black in JPG output.
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Render a page so its longest side is about `px` pixels; returns a data URL. */
export async function renderThumbnail(doc: PDFDocumentProxy, index: number, px = 220) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = (px * (window.devicePixelRatio || 1)) / Math.max(base.width, base.height);
  const canvas = await renderPage(doc, index, scale);
  return { url: canvas.toDataURL("image/jpeg", 0.8), width: base.width, height: base.height };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Your browser couldn't encode this image."))),
      type,
      quality,
    ),
  );
}
