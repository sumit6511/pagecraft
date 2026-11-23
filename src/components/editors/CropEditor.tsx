"use client";

import { useEffect, useRef, useState } from "react";
import type { CropRect } from "@/lib/client/images";

interface Props {
  file: File;
  onChange: (rect: CropRect) => void;
}

/** Crop box in fractions (0–1) of the displayed image. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RATIOS = [
  { label: "Free", value: 0 },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:4", value: 3 / 4 },
];

type Handle = "move" | "nw" | "ne" | "sw" | "se";

export function CropEditor({ file, onChange }: Props) {
  const img = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<Box>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [ratio, setRatio] = useState(0);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    if (img.current) img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    if (!natural.w) return;
    onChange({ x: box.x * natural.w, y: box.y * natural.h, w: box.w * natural.w, h: box.h * natural.h });
  }, [box, natural, onChange]);

  /** Fit the largest centered box with the chosen pixel ratio. */
  const applyRatio = (r: number) => {
    setRatio(r);
    if (!r || !natural.w) return;
    const imgRatio = natural.w / natural.h;
    const w = r > imgRatio ? 0.9 : (0.9 * r) / imgRatio;
    const h = r > imgRatio ? (0.9 * imgRatio) / r : 0.9;
    setBox({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const begin = (e: React.PointerEvent, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = frame.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, box };
    // Ratio expressed in fraction units of this image.
    const fr = ratio ? (ratio * natural.h) / natural.w : 0;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width;
      const dy = (ev.clientY - start.y) / rect.height;
      const b = start.box;
      if (handle === "move") {
        setBox({ ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) });
        return;
      }
      const left = handle === "nw" || handle === "sw";
      const top = handle === "nw" || handle === "ne";
      let x0 = left ? clamp(b.x + dx, 0, b.x + b.w - 0.02) : b.x;
      let x1 = left ? b.x + b.w : clamp(b.x + b.w + dx, b.x + 0.02, 1);
      let y0 = top ? clamp(b.y + dy, 0, b.y + b.h - 0.02) : b.y;
      let y1 = top ? b.y + b.h : clamp(b.y + b.h + dy, b.y + 0.02, 1);
      if (fr) {
        // Keep the ratio: width drives height, then shrink both if out of bounds.
        let w = x1 - x0;
        let h = w / fr;
        const maxH = top ? y1 : 1 - y0;
        if (h > maxH) {
          h = maxH;
          w = h * fr;
        }
        if (left) x0 = x1 - w;
        else x1 = x0 + w;
        if (top) y0 = y1 - h;
        else y1 = y0 + h;
      }
      setBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const px = { w: Math.round(box.w * natural.w), h: Math.round(box.h * natural.h) };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {RATIOS.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => applyRatio(r.value)}
            className={`rounded-lg border px-3 py-1 text-sm ${
              ratio === r.value ? "border-ink bg-ink text-bg" : "border-line-strong text-muted hover:text-ink"
            }`}
          >
            {r.label}
          </button>
        ))}
        {natural.w > 0 && (
          <span className="ml-auto font-mono text-xs text-muted">
            {px.w} × {px.h} px
          </span>
        )}
      </div>
      <div className="flex justify-center rounded-xl bg-surface-2 p-3">
        <div ref={frame} className="relative inline-block touch-none select-none">
          {
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={img}
              alt="Image to crop"
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="block max-h-[560px] w-auto max-w-full"
            />
          }
          {natural.w > 0 && (
            <>
              {/* Dim everything outside the box, clipped to the image */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                  className="absolute"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                  }}
                />
              </div>
              <div
                onPointerDown={(e) => begin(e, "move")}
                className="absolute cursor-move border-2 border-white"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
              >
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} className="border border-white/25" />
                  ))}
                </div>
                {(["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span
                    key={h}
                    onPointerDown={(e) => begin(e, h)}
                    className="absolute size-4 rounded-sm border-2 border-white bg-black/40"
                    style={{
                      left: h.endsWith("w") ? -8 : undefined,
                      right: h.endsWith("e") ? -8 : undefined,
                      top: h.startsWith("n") ? -8 : undefined,
                      bottom: h.startsWith("s") ? -8 : undefined,
                      cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
