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
  tesseract: process.env.TESSERACT_BIN ?? "tesseract",
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
/** Damaged files sometimes have junk before the header; accept %PDF in the first 1 KB. */
const looksLikePdf = (b: Uint8Array) => Buffer.from(b.subarray(0, 1024)).includes("%PDF");

/** Identify an image by its signature rather than trusting the file name. */
function imageExt(b: Uint8Array): string | null {
  const ascii = (o: number, n: number) => Buffer.from(b.subarray(o, o + n)).toString("latin1");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return ".png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return ".webp";
  if (ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*") return ".tif";
  if (ascii(0, 2) === "BM") return ".bmp";
  return null;
}

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
      // Open HTML in regular Writer: the default Writer/Web export drops headings
      // and adds a blank first page on LibreOffice 7.x.
      ...(/\.html?$/i.test(file) ? ["--infilter=HTML (StarWriter)"] : []),
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

const GS_BASE = ["-sDEVICE=pdfwrite", "-dSAFER", "-dNOPAUSE", "-dBATCH", "-dQUIET"];

function gsFailure(input: ServerInput, err: unknown, verb: string) {
  if (err instanceof ToolError) return err;
  const enc = err instanceof ExecError && /password|encrypt/i.test(err.stderr);
  return new ToolError(
    enc
      ? `"${input.name}" is password-protected. Unlock it first.`
      : timedOut(err)
        ? `"${input.name}" took too long to ${verb}.`
        : `"${input.name}" couldn't be ${verb === "convert" ? "converted" : verb + "ed"}. It may be damaged; try Repair PDF.`,
  );
}

async function grayscalePdf(input: ServerInput): Promise<ServerOutput> {
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    try {
      await run(
        BIN.gs,
        [...GS_BASE, "-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray", "-dOverrideICC", "-sOutputFile=out.pdf", "in.pdf"],
        { cwd: dir, timeoutMs: 240_000 },
      );
    } catch (err) {
      throw gsFailure(input, err, "convert");
    }
    return { name: `${stem}_grayscale.pdf`, bytes: await readFile(path.join(dir, "out.pdf")) };
  });
}

async function repairPdf(input: ServerInput): Promise<ServerOutput> {
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    // qpdf rebuilds broken cross-reference tables while keeping everything else intact.
    try {
      const r = await qpdf(dir, ["in.pdf", "out.pdf"]);
      const note = r.code === 3 ? "Problems found and repaired." : "No damage found; the file was rewritten cleanly.";
      return { name: `${stem}_repaired.pdf`, bytes: await readFile(path.join(dir, "out.pdf")), note };
    } catch (err) {
      if (err instanceof ToolError) throw err;
      if (err instanceof ExecError && /password/i.test(err.stderr)) {
        throw new ToolError(`"${input.name}" is password-protected. Unlock it first.`);
      }
    }
    // Fall back to Ghostscript, which re-renders whatever content it can still read.
    try {
      await run(BIN.gs, [...GS_BASE, "-sOutputFile=out.pdf", "in.pdf"], { cwd: dir, timeoutMs: 240_000 });
      return {
        name: `${stem}_repaired.pdf`,
        bytes: await readFile(path.join(dir, "out.pdf")),
        note: "Heavily damaged; recovered what could be read. Check the result.",
      };
    } catch {
      throw new ToolError(`"${input.name}" is too badly damaged to recover.`);
    }
  });
}

async function pdfToPdfa(input: ServerInput): Promise<ServerOutput> {
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ".pdf");
    await writeFile(path.join(dir, "in.pdf"), input.bytes);
    try {
      // --tesseract-timeout 0 turns OCR off, so this is a pure PDF/A conversion.
      await run(
        BIN.ocrmypdf,
        ["--skip-text", "--tesseract-timeout", "0", "--output-type", "pdfa-2", "--jobs", "2", "in.pdf", "out.pdf"],
        { cwd: dir, timeoutMs: 300_000, env: { ...process.env, HOME: dir } },
      );
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const e = err as ExecError;
      // ocrmypdf exit codes: 8 = encrypted, 10 = PDF/A conversion failed.
      if (e.code === 8) throw new ToolError(`"${input.name}" is password-protected. Unlock it first.`);
      if (e.code === 10) throw new ToolError(`"${input.name}" couldn't be made PDF/A compliant. Try Repair PDF first.`);
      throw new ToolError(timedOut(err) ? `"${input.name}" took too long to convert.` : `"${input.name}" couldn't be converted.`);
    }
    return { name: `${stem}_pdfa.pdf`, bytes: await readFile(path.join(dir, "out.pdf")), note: "PDF/A-2b" };
  });
}

async function imageToText(input: ServerInput, o: Record<string, string>): Promise<ServerOutput> {
  const ext = imageExt(input.bytes);
  if (!ext) throw new ToolError(`"${input.name}" isn't a supported image (JPG, PNG, WebP, TIFF or BMP).`);
  const lang = OCR_LANGS.has(o.language) ? o.language : "eng";
  return withTempDir(async (dir) => {
    const { stem } = safeName(input.name, ext);
    await writeFile(path.join(dir, `in${ext}`), input.bytes);
    let text: string;
    try {
      ({ stdout: text } = await run(BIN.tesseract, [`in${ext}`, "stdout", "-l", lang], {
        cwd: dir,
        timeoutMs: 120_000,
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      }));
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(timedOut(err) ? `"${input.name}" took too long to read.` : `Couldn't read text from "${input.name}".`);
    }
    const clean = text.replace(/\f/g, "").trim();
    return {
      name: `${stem}.txt`,
      bytes: new TextEncoder().encode(clean + "\n"),
      note: clean ? undefined : "No text found in this image.",
    };
  });
}

/** What each server tool expects as input. */
const INPUT_KIND: Record<string, "pdf" | "damaged-pdf" | "office" | "image"> = {
  "office-to-pdf": "office",
  "image-to-text": "image",
  "repair-pdf": "damaged-pdf",
};

export async function runServerTool(tool: ToolDef, inputs: ServerInput[], opts: Record<string, string>): Promise<ServerOutput[]> {
  const out: ServerOutput[] = [];
  const kind = INPUT_KIND[tool.slug] ?? "pdf";
  for (const input of inputs) {
    if (kind === "pdf" && !isPdf(input.bytes)) throw new ToolError(`"${input.name}" isn't a PDF.`);
    if (kind === "damaged-pdf" && !looksLikePdf(input.bytes)) {
      throw new ToolError(`"${input.name}" doesn't look like a PDF at all, so it can't be repaired.`);
    }
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
      case "grayscale-pdf":
        out.push(await grayscalePdf(input));
        break;
      case "repair-pdf":
        out.push(await repairPdf(input));
        break;
      case "pdf-to-pdfa":
        out.push(await pdfToPdfa(input));
        break;
      case "image-to-text":
        out.push(await imageToText(input, opts));
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
  const [soffice, gs, qpdfOk, ocr, tess] = await Promise.all([
    probe(BIN.soffice, ["--version"]),
    probe(BIN.gs, ["--version"]),
    probe(BIN.qpdf, ["--version"]),
    probe(BIN.ocrmypdf, ["--version"]),
    probe(BIN.tesseract, ["--version"]),
  ]);
  return { soffice, gs, qpdf: qpdfOk, ocrmypdf: ocr, tesseract: tess, tmp: (await stat(tmpdir())).isDirectory() };
}
