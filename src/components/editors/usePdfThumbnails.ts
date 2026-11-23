"use client";

import { useEffect, useState } from "react";
import { openPdfForRender, renderThumbnail } from "@/lib/client/render";

export interface Thumb {
  url: string;
  /** Visible page size in points (rotation applied). */
  width: number;
  height: number;
}

/**
 * Render every page of `file` to a small thumbnail, one page at a time.
 * Callers remount (via `key`) when the file changes, so state starts fresh.
 */
export function usePdfThumbnails(file: File, px = 220) {
  const [count, setCount] = useState(0);
  const [thumbs, setThumbs] = useState<(Thumb | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    (async () => {
      try {
        const doc = await openPdfForRender(await file.arrayBuffer());
        destroy = () => doc.loadingTask.destroy();
        if (cancelled) return;
        setCount(doc.numPages);
        setThumbs(Array(doc.numPages).fill(undefined));
        for (let i = 0; i < doc.numPages && !cancelled; i++) {
          const t = await renderThumbnail(doc, i, px);
          if (cancelled) break;
          setThumbs((prev) => {
            const next = prev.slice();
            next[i] = t;
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't open this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [file, px]);

  return { count, thumbs, error };
}
