"use client";

import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Download, FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolError } from "@/lib/pages";
import { prefillOptions, runClientTool, runServerTool, zipOutputs, type EditorState } from "@/lib/client/run";
import type { Output } from "@/lib/client/types";
import type { CropRect } from "@/lib/client/images";
import type { OrganizeItem, SignPlacement } from "@/lib/client/pdf";
import { defaultOptions, getTool, isFieldVisible } from "@/lib/tools";
import { Dropzone, describeAccept } from "./Dropzone";
import { OptionsForm } from "./OptionsForm";
import { CropEditor } from "./editors/CropEditor";
import { OrganizeEditor } from "./editors/OrganizeEditor";
import { SignEditor } from "./editors/SignEditor";

interface Picked {
  id: string;
  file: File;
}

type Status = { kind: "idle" } | { kind: "running"; progress?: number } | { kind: "done"; outputs: Output[] } | { kind: "error"; message: string };

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ToolWorkspace({ slug }: { slug: string }) {
  const tool = getTool(slug)!;
  const [files, setFiles] = useState<Picked[]>([]);
  const [opts, setOpts] = useState(() => defaultOptions(tool));
  const [editor, setEditor] = useState<EditorState>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const addFiles = (picked: File[], rejected: string[]) => {
    setNotice(rejected.length ? `Skipped ${rejected.join(", ")}: not a supported file type (${describeAccept(tool.accept)}).` : null);
    if (picked.length === 0) return;
    const items = picked.map((file) => ({ id: crypto.randomUUID(), file }));
    setFiles((prev) => (tool.multiple ? [...prev, ...items] : items.slice(0, 1)));
    setStatus({ kind: "idle" });
    if (tool.prefill) {
      // Show the file's current values (e.g. its title) so the user edits rather than retypes.
      prefillOptions(tool, picked[0])
        .then((values) => setOpts({ ...defaultOptions(tool), ...values }))
        .catch((err) => setNotice(err instanceof Error ? err.message : "Couldn't read this file."));
    }
  };

  const onOrganize = useCallback((plan: OrganizeItem[]) => setEditor({ kind: "organize", plan }), []);
  const onSign = useCallback((placements: SignPlacement[]) => setEditor({ kind: "sign", placements }), []);
  const onCrop = useCallback((rect: CropRect) => setEditor({ kind: "crop", rect }), []);

  const problem = useMemo(() => {
    if (files.length < tool.minFiles) return tool.minFiles > 1 ? `Add at least ${tool.minFiles} files.` : null;
    for (const f of tool.fields) {
      if ("required" in f && f.required && isFieldVisible(f, opts) && !opts[f.name]?.trim()) return `Fill in “${f.label}”.`;
    }
    if (tool.slug === "protect-pdf" && opts.password !== opts.confirm) return "The passwords don't match.";
    if (tool.editor === "sign" && (editor?.kind !== "sign" || editor.placements.length === 0)) return "Place your signature on a page.";
    if (tool.editor === "organize" && editor?.kind === "organize" && editor.plan.length === 0) return "Keep at least one page.";
    return null;
  }, [files.length, tool, opts, editor]);

  const run = async () => {
    if (problem) return;
    setStatus({ kind: "running" });
    abort.current = new AbortController();
    const list = files.map((f) => f.file);
    try {
      const outputs =
        tool.runtime === "server"
          ? await runServerTool(tool, list, opts, abort.current.signal)
          : await runClientTool(tool, list, opts, editor, (p) => setStatus({ kind: "running", progress: p }));
      setStatus({ kind: "done", outputs });
    } catch (err) {
      if (abort.current?.signal.aborted) return setStatus({ kind: "idle" });
      if (!(err instanceof ToolError)) console.error(err);
      setStatus({
        kind: "error",
        message: err instanceof ToolError || (err instanceof Error && err.message && tool.runtime === "client")
          ? (err as Error).message
          : "Something went wrong. Please try again.",
      });
    }
  };

  const reset = () => {
    abort.current?.abort();
    setFiles([]);
    setEditor(undefined);
    setStatus({ kind: "idle" });
    setNotice(null);
  };

  if (status.kind === "done") {
    return <Results outputs={status.outputs} toolName={tool.name} onBack={() => setStatus({ kind: "idle" })} onReset={reset} />;
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Dropzone accept={tool.accept} multiple={tool.multiple} onFiles={addFiles} />
        {notice && <Notice tone="warn">{notice}</Notice>}
        {tool.runtime === "server" && (
          <p className="text-center text-xs text-muted">Files are uploaded over HTTPS, processed, and deleted immediately.</p>
        )}
      </div>
    );
  }

  const running = status.kind === "running";
  const move = (i: number, d: number) =>
    setFiles((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        {tool.editor === "organize" && <OrganizeEditor key={files[0].id} file={files[0].file} onChange={onOrganize} />}
        {tool.editor === "sign" && <SignEditor key={files[0].id} file={files[0].file} onChange={onSign} />}
        {tool.editor === "crop" && <CropEditor key={files[0].id} file={files[0].file} onChange={onCrop} />}
        {!tool.editor && (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {files.map((f, i) => (
                <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                  <FileThumb file={f.file} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.file.name}</p>
                    <p className="text-xs text-muted">{formatBytes(f.file.size)}</p>
                  </div>
                  {tool.orderable && files.length > 1 && (
                    <div className="flex">
                      <SmallBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0 || running}>
                        <ArrowUp size={15} />
                      </SmallBtn>
                      <SmallBtn label="Move down" onClick={() => move(i, 1)} disabled={i === files.length - 1 || running}>
                        <ArrowDown size={15} />
                      </SmallBtn>
                    </div>
                  )}
                  <SmallBtn label={`Remove ${f.file.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} disabled={running}>
                    <X size={15} />
                  </SmallBtn>
                </li>
              ))}
            </ul>
            {tool.multiple && <Dropzone compact accept={tool.accept} multiple onFiles={addFiles} />}
          </div>
        )}
        {notice && <div className="mt-3"><Notice tone="warn">{notice}</Notice></div>}
      </div>

      <aside className="flex h-fit flex-col gap-5 rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20">
        <OptionsForm fields={tool.fields} values={opts} onChange={(k, v) => setOpts((o) => ({ ...o, [k]: v }))} />
        {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={run}
            disabled={!!problem || running}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running && <LoaderCircle size={18} className="animate-spin" />}
            {running
              ? status.progress !== undefined
                ? `Working… ${Math.round(status.progress * 100)}%`
                : tool.runtime === "server"
                  ? "Uploading & processing…"
                  : "Working…"
              : tool.action}
          </button>
          {problem && !running && <p className="text-center text-xs text-muted">{problem}</p>}
          {running && tool.runtime === "server" && (
            <button type="button" onClick={() => abort.current?.abort()} className="text-sm text-muted hover:text-ink">
              Cancel
            </button>
          )}
          <button type="button" onClick={reset} disabled={running} className="text-sm text-muted hover:text-ink disabled:opacity-40">
            Start over
          </button>
        </div>
      </aside>
    </div>
  );
}

function Results({ outputs, toolName, onBack, onReset }: { outputs: Output[]; toolName: string; onBack: () => void; onReset: () => void }) {
  const [zipping, setZipping] = useState(false);
  const total = outputs.reduce((n, o) => n + o.blob.size, 0);
  const downloadAll = async () => {
    setZipping(true);
    try {
      download(await zipOutputs(outputs), `${toolName.toLowerCase().replace(/\s+/g, "-")}.zip`);
    } finally {
      setZipping(false);
    }
  };
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
          <CircleCheck size={24} />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Done!</h2>
          <p className="text-sm text-muted">
            {outputs.length} file{outputs.length === 1 ? "" : "s"} ready · {formatBytes(total)}
          </p>
        </div>
      </div>

      {outputs.length === 1 ? (
        <button
          type="button"
          onClick={() => download(outputs[0].blob, outputs[0].name)}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-lg font-semibold text-brand-ink hover:opacity-90"
        >
          <Download size={20} /> Download {outputs[0].name}
        </button>
      ) : (
        <button
          type="button"
          onClick={downloadAll}
          disabled={zipping}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-lg font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
        >
          {zipping ? <LoaderCircle size={20} className="animate-spin" /> : <Download size={20} />} Download all (.zip)
        </button>
      )}

      <ul className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {outputs.map((o, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2.5">
            <FileText size={18} className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{o.name}</p>
              <p className="text-xs text-muted">
                {formatBytes(o.blob.size)}
                {o.note && <> · {o.note}</>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => download(o.blob, o.name)}
              className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-sm hover:border-brand hover:text-brand"
            >
              <Download size={14} /> Save
            </button>
          </li>
        ))}
      </ul>

      <div className="flex justify-center gap-6 text-sm">
        <button type="button" onClick={onBack} className="text-muted hover:text-ink">
          ← Back to options
        </button>
        <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-muted hover:text-ink">
          <RotateCcw size={14} /> Process new files
        </button>
      </div>
    </div>
  );
}

function FileThumb({ file }: { file: File }) {
  const img = useRef<HTMLImageElement>(null);
  const isImage = file.type.startsWith("image/");
  useEffect(() => {
    if (!isImage || !img.current) return;
    const u = URL.createObjectURL(file);
    img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-[10px] font-semibold text-muted uppercase">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {isImage ? <img ref={img} alt="" className="size-full object-cover" /> : file.name.split(".").pop()?.slice(0, 4)}
    </span>
  );
}

function SmallBtn(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl p-3 text-sm ${tone === "error" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"}`}>
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
