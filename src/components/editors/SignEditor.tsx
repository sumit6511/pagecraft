"use client";

import { Eraser, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SignPlacement } from "@/lib/client/pdf";
import { openPdfForRender, renderThumbnail } from "@/lib/client/render";
import { usePdfThumbnails } from "./usePdfThumbnails";

interface Props {
  file: File;
  onChange: (placements: SignPlacement[]) => void;
}

interface Sig {
  png: string;
  /** width / height of the signature image */
  aspect: number;
}

export function SignEditor({ file, onChange }: Props) {
  const { count, thumbs, error } = usePdfThumbnails(file, 120);
  const [sig, setSig] = useState<Sig | null>(null);
  const [page, setPage] = useState(0);
  const [placements, setPlacements] = useState<SignPlacement[]>([]);

  useEffect(() => onChange(placements), [placements, onChange]);

  if (error) return <p className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>;

  if (!sig) return <SignaturePad onDone={setSig} />;

  const thumb = thumbs[page];
  const addHere = () => {
    if (!thumb) return;
    const w = 0.3;
    const h = (w * thumb.width) / sig.aspect / thumb.height;
    setPlacements((p) => [...p, { pageIndex: page, x: 0.62, y: Math.max(0, 0.86 - h), w, h, png: sig.png }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 items-center rounded-lg border border-line bg-white px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sig.png} alt="Your signature" className="max-h-9" />
        </div>
        <button type="button" onClick={() => setSig(null)} className="text-sm text-muted underline hover:text-ink">
          Change signature
        </button>
        <button
          type="button"
          onClick={addHere}
          disabled={!thumb}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          <Plus size={15} /> Place on page {page + 1}
        </button>
      </div>

      <div className="flex gap-4">
        <ol className="hidden max-h-[640px] w-24 shrink-0 flex-col gap-2 overflow-y-auto pr-1 sm:flex">
          {Array.from({ length: count }, (_, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setPage(i)}
                className={`relative w-full overflow-hidden rounded-md border-2 ${i === page ? "border-brand" : "border-transparent"}`}
              >
                {thumbs[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[i]!.url} alt={`Page ${i + 1}`} className="w-full" />
                ) : (
                  <div className="aspect-[3/4] bg-surface-2" />
                )}
                <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                {placements.some((p) => p.pageIndex === i) && (
                  <span className="absolute top-1 left-1 size-2 rounded-full bg-brand" aria-label="Signed" />
                )}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 text-sm sm:hidden">
            <label htmlFor="sign-page">Page</label>
            <select id="sign-page" className="field w-auto" value={page} onChange={(e) => setPage(Number(e.target.value))}>
              {Array.from({ length: count }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
          <PagePreview
            file={file}
            index={page}
            placements={placements}
            onUpdate={(idx, patch) => setPlacements((p) => p.map((pl, i) => (i === idx ? { ...pl, ...patch } : pl)))}
            onRemove={(idx) => setPlacements((p) => p.filter((_, i) => i !== idx))}
          />
          <p className="mt-2 text-xs text-muted">Drag the signature to move it; drag its corner to resize.</p>
        </div>
      </div>
    </div>
  );
}

function PagePreview(props: {
  file: File;
  index: number;
  placements: SignPlacement[];
  onUpdate: (idx: number, patch: Partial<SignPlacement>) => void;
  onRemove: (idx: number) => void;
}) {
  const { file, index, placements, onUpdate, onRemove } = props;
  const [url, setUrl] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // One shared load per file, even if the user flips pages before it finishes.
  const docRef = useRef<ReturnType<typeof openPdfForRender> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      docRef.current ??= file.arrayBuffer().then(openPdfForRender);
      const t = await renderThumbnail(await docRef.current, index, 900);
      if (alive) setUrl(t.url);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [file, index]);

  useEffect(
    () => () => {
      void docRef.current?.then((d) => d.loadingTask.destroy());
      docRef.current = null;
    },
    [file],
  );

  const startDrag = (e: React.PointerEvent, idx: number, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    const rect = box.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, pl: placements[idx] };
    const aspect = start.pl.h / start.pl.w;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width;
      const dy = (ev.clientY - start.y) / rect.height;
      if (mode === "move") {
        onUpdate(idx, {
          x: clamp(start.pl.x + dx, 0, 1 - start.pl.w),
          y: clamp(start.pl.y + dy, 0, 1 - start.pl.h),
        });
      } else {
        const w = clamp(start.pl.w + dx, 0.05, 1 - start.pl.x);
        const h = w * aspect;
        if (start.pl.y + h <= 1) onUpdate(idx, { w, h });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex justify-center rounded-xl bg-surface-2 p-3">
      <div ref={box} className="relative inline-block touch-none select-none">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Page ${index + 1}`} className="block max-h-[620px] w-auto max-w-full shadow-md" draggable={false} />
        ) : (
          <div className="flex h-[400px] w-[300px] items-center justify-center bg-surface text-sm text-muted">Rendering…</div>
        )}
        {url &&
          placements.map((pl, i) =>
            pl.pageIndex !== index ? null : (
              <div
                key={i}
                onPointerDown={(e) => startDrag(e, i, "move")}
                className="group absolute cursor-move outline-2 outline-dashed outline-brand"
                style={{ left: `${pl.x * 100}%`, top: `${pl.y * 100}%`, width: `${pl.w * 100}%`, height: `${pl.h * 100}%` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pl.png} alt="Signature" className="pointer-events-none size-full" draggable={false} />
                <button
                  type="button"
                  aria-label="Remove signature"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemove(i)}
                  className="absolute -top-3 -right-3 flex size-6 items-center justify-center rounded-full bg-danger text-white shadow"
                >
                  <X size={13} />
                </button>
                <span
                  onPointerDown={(e) => startDrag(e, i, "resize")}
                  className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-brand bg-surface"
                  aria-hidden
                />
              </div>
            ),
          )}
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Draw or type a signature; returns a cropped transparent PNG. */
function SignaturePad({ onDone }: { onDone: (s: Sig) => void }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [text, setText] = useState("");
  const [color, setColor] = useState("#1d3a8a");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawn.current = false;
    setHasInk(false);
  }, []);

  useEffect(() => {
    if (mode === "draw") setup();
  }, [mode, setup]);

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (e.type === "pointerdown") {
      c.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.6;
      ctx.lineTo(x + 0.1, y + 0.1);
      ctx.stroke();
    } else if (e.buttons === 1) {
      ctx.lineWidth = Math.max(1.6, 3.2 - Math.hypot(e.movementX, e.movementY) * 0.08);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    if (!drawn.current) {
      drawn.current = true;
      setHasInk(true);
    }
  };

  const finish = () => {
    let src: HTMLCanvasElement;
    if (mode === "type") {
      src = document.createElement("canvas");
      const ctx = src.getContext("2d")!;
      const font = `italic 600 96px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(text).width) + 40;
      src.width = w;
      src.height = 160;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(text, 20, 80);
    } else {
      src = canvas.current!;
    }
    const cropped = trim(src);
    if (cropped) onDone({ png: cropped.toDataURL("image/png"), aspect: cropped.width / cropped.height });
  };

  const ready = mode === "draw" ? hasInk : text.trim().length > 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        {(["draw", "type"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-sm capitalize ${mode === m ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
          >
            {m}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {["#1d1d1b", "#1d3a8a", "#0b6e4f"].map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Ink color ${c}`}
              onClick={() => setColor(c)}
              className={`size-6 rounded-full border-2 ${color === c ? "border-brand" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      {mode === "draw" ? (
        <div className="relative">
          <canvas
            ref={canvas}
            onPointerDown={draw}
            onPointerMove={draw}
            className="h-48 w-full touch-none rounded-xl border border-dashed border-line-strong bg-white"
          />
          <button
            type="button"
            onClick={setup}
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-neutral-600 shadow-sm"
          >
            <Eraser size={13} /> Clear
          </button>
          {!hasInk && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
              Sign here with your mouse, finger or stylus
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your name" className="field" maxLength={60} />
          <div
            className="flex h-32 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-white text-5xl"
            style={{ color, fontFamily: `"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`, fontStyle: "italic" }}
          >
            {text || <span className="text-base text-neutral-400 not-italic">Preview</span>}
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={!ready}
        onClick={finish}
        className="mt-4 w-full rounded-xl bg-brand py-2.5 font-semibold text-brand-ink disabled:opacity-40"
      >
        Use this signature
      </button>
    </div>
  );
}

/** Crop a canvas to the bounding box of its non-transparent pixels. */
function trim(src: HTMLCanvasElement) {
  const ctx = src.getContext("2d")!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
