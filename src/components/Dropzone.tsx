"use client";

import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { fileMatchesAccept } from "@/lib/tools";

interface Props {
  accept: string;
  multiple: boolean;
  onFiles: (files: File[], rejected: string[]) => void;
  compact?: boolean;
  label?: string;
}

/** Human-readable list of accepted extensions, e.g. "PDF" or "JPG, PNG, WEBP". */
export function describeAccept(accept: string) {
  const exts = accept
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.startsWith("."))
    .map((a) => a.slice(1).toUpperCase())
    .filter((e) => e !== "JPEG");
  return exts.join(", ");
}

export function Dropzone({ accept, multiple, onFiles, compact, label }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (!list) return;
    const all = Array.from(list);
    const ok = all.filter((f) => fileMatchesAccept(f, accept));
    const rejected = all.filter((f) => !ok.includes(f)).map((f) => f.name);
    onFiles(multiple ? ok : ok.slice(0, 1), rejected);
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept={accept}
      multiple={multiple}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        take(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      take(e.dataTransfer.files);
    },
  };

  if (compact) {
    return (
      <button
        type="button"
        {...dragProps}
        onClick={() => input.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm transition ${
          over ? "border-brand bg-brand-soft text-brand" : "border-line-strong text-muted hover:border-brand hover:text-brand"
        }`}
      >
        <Plus size={16} /> {label ?? "Add more files"}
        {picker}
      </button>
    );
  }

  return (
    <div
      {...dragProps}
      className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-16 text-center transition sm:py-24 ${
        over ? "border-brand bg-brand-soft" : "border-line-strong bg-surface"
      }`}
    >
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Upload size={26} />
      </span>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-brand-ink shadow-sm hover:opacity-90"
      >
        Select {multiple ? "files" : "a file"}
      </button>
      <p className="mt-3 text-sm text-muted">
        or drop {multiple ? "them" : "it"} here · {describeAccept(accept)}
      </p>
      {picker}
    </div>
  );
}
