import "server-only";

import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ToolError, baseName } from "../pages";
import type { ToolDef } from "../tools";

export interface ServerInput {
  name: string;
  bytes: Uint8Array;
}
export interface ServerOutput {
  name: string;
  bytes: Uint8Array;
  note?: string;
}

const BIN = {
  soffice: process.env.SOFFICE_BIN ?? "soffice",
  gs: process.env.GS_BIN ?? "gs",
  qpdf: process.env.QPDF_BIN ?? "qpdf",
  ocrmypdf: process.env.OCRMYPDF_BIN ?? "ocrmypdf",
};

class ExecError extends Error {
  constructor(
    message: string,
    public code: number | null,
    public stderr: string,
    public timedOut: boolean,
  ) {
    super(message);
  }
}

/** Run a binary without a shell; resolves with stdout/stderr. */
function run(bin: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, env: opts.env ?? process.env },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr, code: 0 });
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        if (e.code === "ENOENT") return reject(new ToolError(`This server is missing ${path.basename(bin)}, so this tool is unavailable.`));
        const code = typeof e.code === "number" ? e.code : null;
        reject(new ExecError(`${path.basename(bin)} failed`, code, String(stderr), Boolean(e.killed)));
      },
    );
  });
}

/** Keep names readable but safe on disk; the original extension matters for LibreOffice. */
function safeName(name: string, fallbackExt: string) {
  const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/)?.[0]) ?? fallbackExt;
  const stem = baseName(path.basename(name)).normalize("NFKC").replace(/[^\p{L}\p{N} ._-]+/gu, "_").replace(/^[.\s]+/, "").slice(0, 80) || "file";
  return { stem, ext, file: `${stem}${ext}` };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pagecraft-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

function timedOut(err: unknown) {
  return err instanceof ExecError && err.timedOut;
}

// ── Tools ──────────────────────────────────────────────────────────────────

async function libreOfficeConvert(input: ServerInput, target: "pdf" | "docx", importPdf: boolean): Promise<ServerOutput> {
  return withTempDir(async (dir) => {
    const { stem, file } = safeName(input.name, importPdf ? ".pdf" : ".docx");
    await writeFile(path.join(dir, file), input.bytes);
    const filter = target === "docx" ? 'docx:"MS Word 2007 XML"' : "pdf";
    const args = [
      // A private profile per job lets conversions run in parallel.
      `-env:UserInstallation=file://${path.join(dir, "profile")}`,
      "--headless",
      "--norestore",
      "--nolockcheck",
      ...(importPdf ? ["--infilter=writer_pdf_import"] : []),
      "--convert-to",
      filter.replace(/"/g, ""),
      "--outdir",
      path.join(dir, "out"),
      file,
    ];
    try {
      await run(BIN.soffice, args, { cwd: dir, timeoutMs: 180_000, env: { ...process.env, HOME: dir } });
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(timedOut(err) ? `"${input.name}" took too long to convert.` : `"${input.name}" couldn't be converted.`);
    }
    const outDir = path.join(dir, "out");
    const produced = await readdir(outDir).catch(() => [] as string[]);
    const hit = produced.find((f) => f.toLowerCase().endsWith(`.${target}`));
    if (!hit) throw new ToolError(`"${input.name}" couldn't be converted. Is it a valid document?`);
    return { name: `${stem}.${target}`, bytes: await readFile(path.join(outDir, hit)) };
  });
}

const GS_LEVELS = new Set(["screen", "ebook", "printer"]);

async function compressPdf(input: ServerInput, o: Record<string, string>): Promise<ServerOutput> {
  const level = GS_LEVELS.has(o.level) ? o.level : "ebook";
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    try {
      await run(
        BIN.gs,
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.5",
          `-dPDFSETTINGS=/${level}`,
          "-dSAFER",
          "-dNOPAUSE",
          "-dBATCH",
          "-dQUIET",
          "-dDetectDuplicateImages=true",
          "-dCompressFonts=true",
          "-sOutputFile=out.pdf",
          "in.pdf",
        ],
        { cwd: dir, timeoutMs: 240_000 },
      );
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const enc = err instanceof ExecError && /password|encrypt/i.test(err.stderr);
      throw new ToolError(
        enc
          ? `"${input.name}" is password-protected. Unlock it first.`
          : timedOut(err)
            ? `"${input.name}" took too long to compress.`
            : `"${input.name}" couldn't be compressed. It may be damaged.`,
      );
    }
    const out = await readFile(path.join(dir, "out.pdf"));
    if (out.length >= input.bytes.length) {
      return { name: `${stem}.pdf`, bytes: input.bytes, note: "Already well optimized; kept the original." };
    }
    const saved = Math.round((1 - out.length / input.bytes.length) * 100);
    return { name: `${stem}_compressed.pdf`, bytes: out, note: `${saved}% smaller` };
  });
}

/** qpdf with arguments in a 0600 file so passwords never appear in `ps`. */
async function qpdf(dir: string, args: string[]) {
  const argFile = path.join(dir, "args");
  await writeFile(argFile, args.join("\n") + "\n", { mode: 0o600 });
  await chmod(argFile, 0o600);
  try {
    return await run(BIN.qpdf, [`@${argFile}`], { cwd: dir, timeoutMs: 120_000 });
  } catch (err) {
    // Exit code 3 means "succeeded with warnings".
    if (err instanceof ExecError && err.code === 3) return { stdout: "", stderr: err.stderr, code: 3 };
    throw err;
  }
}

function assertPassword(pw: string) {
  if (pw.includes("\n") || pw.includes("\r")) throw new ToolError("Passwords can't contain line breaks.");
}

async function protectPdf(input: ServerInput, o: Record<string, string>): Promise<ServerOutput> {
  const pw = o.password ?? "";
  if (pw.length < 4) throw new ToolError("Use a password of at least 4 characters.");
  if (pw !== o.confirm) throw new ToolError("The two passwords don't match.");
  if (pw.startsWith("-")) throw new ToolError("Passwords can't start with a hyphen.");
  assertPassword(pw);
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    try {
      // Positional form works on every qpdf 11.x (named flags need 11.7+).
      await qpdf(dir, ["--encrypt", pw, pw, "256", "--", "in.pdf", "out.pdf"]);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const enc = err instanceof ExecError && /invalid password|encrypted/i.test(err.stderr);
      throw new ToolError(enc ? `"${input.name}" is already password-protected.` : `"${input.name}" couldn't be encrypted. It may be damaged.`);
    }
    return { name: `${stem}_protected.pdf`, bytes: await readFile(path.join(dir, "out.pdf")) };
  });
}

async function unlockPdf(input: ServerInput, o: Record<string, string>): Promise<ServerOutput> {
  const pw = o.password ?? "";
  assertPassword(pw);
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    const check = await qpdf(dir, ["--is-encrypted", "in.pdf"]).catch(() => null);
    if (check === null) {
      return { name: input.name, bytes: input.bytes, note: "This PDF wasn't password-protected." };
    }
    try {
      await qpdf(dir, [...(pw ? [`--password=${pw}`] : []), "--decrypt", "in.pdf", "out.pdf"]);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const bad = err instanceof ExecError && /invalid password/i.test(err.stderr);
      throw new ToolError(bad ? `Wrong password for "${input.name}".` : `"${input.name}" couldn't be unlocked.`);
    }
    return { name: `${stem}_unlocked.pdf`, bytes: await readFile(path.join(dir, "out.pdf")) };
  });
}

const OCR_LANGS = new Set(["eng"]);

async function ocrPdf(input: ServerInput, o: Record<string, string>): Promise<ServerOutput> {
  const lang = OCR_LANGS.has(o.language) ? o.language : "eng";
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    try {
      await run(
        BIN.ocrmypdf,
        ["-l", lang, o.force === "true" ? "--force-ocr" : "--skip-text", "--jobs", "2", "--output-type", "pdf", "--optimize", "1", "in.pdf", "out.pdf"],
        { cwd: dir, timeoutMs: 600_000, env: { ...process.env, HOME: dir } },
      );
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const e = err as ExecError;
      // ocrmypdf exit codes: 6 = already has text, 8 = encrypted.
      if (e.code === 6) throw new ToolError(`"${input.name}" already has selectable text. Tick "Re-OCR" to redo it.`);
      if (e.code === 8) throw new ToolError(`"${input.name}" is password-protected. Unlock it first.`);
      throw new ToolError(timedOut(err) ? `"${input.name}" took too long to OCR. Try fewer pages.` : `OCR failed for "${input.name}".`);
    }
    return { name: `${stem}_ocr.pdf`, bytes: await readFile(path.join(dir, "out.pdf")) };
  });
}

export async function runServerTool(tool: ToolDef, inputs: ServerInput[], opts: Record<string, string>): Promise<ServerOutput[]> {
  const out: ServerOutput[] = [];
  for (const input of inputs) {
    const wantsPdf = tool.slug !== "office-to-pdf";
    if (wantsPdf && !isPdf(input.bytes)) throw new ToolError(`"${input.name}" isn't a PDF.`);
    switch (tool.slug) {
      case "office-to-pdf":
        out.push(await libreOfficeConvert(input, "pdf", false));
        break;
      case "pdf-to-word":
        out.push(await libreOfficeConvert(input, "docx", true));
        break;
      case "compress-pdf":
        out.push(await compressPdf(input, opts));
        break;
      case "protect-pdf":
        out.push(await protectPdf(input, opts));
        break;
      case "unlock-pdf":
        out.push(await unlockPdf(input, opts));
        break;
      case "ocr-pdf":
        out.push(await ocrPdf(input, opts));
        break;
      default:
        throw new Error(`No server implementation for ${tool.slug}`);
    }
  }
  return out;
}

/** Which server binaries are present; used by the health endpoint. */
export async function checkBinaries() {
  const probe = async (bin: string, args: string[]) => {
    try {
      const dir = await mkdtemp(path.join(tmpdir(), "pagecraft-probe-"));
      try {
        await run(bin, args, { cwd: dir, timeoutMs: 20_000, env: { ...process.env, HOME: dir } });
        return true;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      return false;
    }
  };
  const [soffice, gs, qpdfOk, ocr] = await Promise.all([
    probe(BIN.soffice, ["--version"]),
    probe(BIN.gs, ["--version"]),
    probe(BIN.qpdf, ["--version"]),
    probe(BIN.ocrmypdf, ["--version"]),
  ]);
  return { soffice, gs, qpdf: qpdfOk, ocrmypdf: ocr, tmp: (await stat(tmpdir())).isDirectory() };
}
