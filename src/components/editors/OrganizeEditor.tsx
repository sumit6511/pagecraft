"use client";

import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrganizeItem } from "@/lib/client/pdf";
import { usePdfThumbnails } from "./usePdfThumbnails";

interface Props {
  file: File;
  onChange: (plan: OrganizeItem[]) => void;
}

export function OrganizeEditor({ file, onChange }: Props) {
  const { count, thumbs, error } = usePdfThumbnails(file);
  const original = useMemo(() => Array.from({ length: count }, (_, index) => ({ index, rotate: 0 })), [count]);
  // null until the user changes something; then their arrangement.
  const [edited, setEdited] = useState<OrganizeItem[] | null>(null);
  const items = edited ?? original;
  const setItems = (fn: (prev: OrganizeItem[]) => OrganizeItem[]) => setEdited((prev) => fn(prev ?? original));
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  useEffect(() => onChange(items), [items, onChange]);

  const move = (from: number, to: number) =>
    setItems((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = prev.slice();
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  const rotate = (pos: number, by: number) =>
    setItems((prev) => prev.map((it, i) => (i === pos ? { ...it, rotate: (it.rotate + by + 360) % 360 } : it)));
  const remove = (pos: number) => setItems((prev) => prev.filter((_, i) => i !== pos));

  if (error) return <p className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>;

  const changed = items.length !== count || items.some((it, i) => it.index !== i || it.rotate !== 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          {items.length} of {count} page{count === 1 ? "" : "s"} · drag to reorder
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setItems((p) => p.map((it) => ({ ...it, rotate: (it.rotate + 90) % 360 })))}
            className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 hover:text-ink"
          >
            <RotateCw size={14} /> Rotate all
          </button>
          {changed && (
            <button
              type="button"
              onClick={() => setEdited(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 hover:text-ink"
            >
              <Undo2 size={14} /> Reset
            </button>
          )}
        </div>
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it, pos) => {
          const t = thumbs[it.index];
          return (
            <li
              key={`${it.index}`}
              draggable
              onDragStart={(e) => {
                dragFrom.current = pos;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropAt(pos);
              }}
              onDragLeave={() => setDropAt((d) => (d === pos ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) move(dragFrom.current, pos);
                dragFrom.current = null;
                setDropAt(null);
              }}
              onDragEnd={() => setDropAt(null)}
              className={`group relative flex cursor-grab flex-col rounded-xl border bg-surface p-2 active:cursor-grabbing ${
                dropAt === pos ? "border-brand ring-2 ring-brand/30" : "border-line"
              }`}
            >
              <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                {t ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.url}
                    alt={`Page ${it.index + 1}`}
                    draggable={false}
                    className="max-h-full max-w-full shadow-sm transition-transform"
                    style={{ transform: `rotate(${it.rotate}deg)` }}
                  />
                ) : (
                  <span className="text-xs text-muted">Loading…</span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="font-medium">
                  {pos + 1}
                  {it.index !== pos && <span className="text-muted"> (was {it.index + 1})</span>}
                </span>
                <span className="flex gap-0.5">
                  <IconBtn label="Move earlier" onClick={() => move(pos, pos - 1)} disabled={pos === 0}>
                    <ArrowLeft size={14} />
                  </IconBtn>
                  <IconBtn label="Move later" onClick={() => move(pos, pos + 1)} disabled={pos === items.length - 1}>
                    <ArrowRight size={14} />
                  </IconBtn>
                  <IconBtn label="Rotate left" onClick={() => rotate(pos, -90)}>
                    <RotateCcw size={14} />
                  </IconBtn>
                  <IconBtn label="Rotate right" onClick={() => rotate(pos, 90)}>
                    <RotateCw size={14} />
                  </IconBtn>
                  <IconBtn label="Delete page" onClick={() => remove(pos)} danger>
                    <Trash2 size={14} />
                  </IconBtn>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function IconBtn(props: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-md p-1 text-muted hover:bg-surface-2 disabled:opacity-30 ${
        props.danger ? "hover:text-danger" : "hover:text-ink"
      }`}
    >
      {props.children}
    </button>
  );
}
