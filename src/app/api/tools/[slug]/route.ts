import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { ToolError } from "@/lib/pages";
import { MAX_FILES, MAX_UPLOAD_BYTES, clientKey, rateLimited, withJobSlot } from "@/lib/server/limits";
import { runServerTool, type ServerInput } from "@/lib/server/run";
import { fileMatchesAccept, getTool, type ToolDef } from "@/lib/tools";

export const maxDuration = 600;

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Accept only option keys the tool defines, with values its fields allow. */
function sanitizeOptions(tool: ToolDef, raw: unknown): Record<string, string> {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const f of tool.fields) {
    const v = typeof input[f.name] === "string" ? (input[f.name] as string).slice(0, 1000) : f.default;
    if (f.type === "select" && !f.options.some((o) => o.value === v)) {
      throw new ToolError(`Invalid value for "${f.label}".`);
    }
    out[f.name] = v;
  }
  return out;
}

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/[slug]">) {
  const { slug } = await ctx.params;
  const tool = getTool(slug);
  if (!tool || tool.runtime !== "server") return fail(404, "Unknown tool.");

  if (rateLimited(clientKey(req.headers))) {
    return fail(429, "Too many requests. Wait a minute and try again.");
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return fail(413, `Files are limited to ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB in total.`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "The upload couldn't be read. Try again.");
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length < tool.minFiles) return fail(400, "Add a file to process.");
  if (files.length > (tool.multiple ? MAX_FILES : 1)) {
    return fail(400, tool.multiple ? `You can process up to ${MAX_FILES} files at once.` : "This tool takes one file.");
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) {
    return fail(413, `Files are limited to ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB in total.`);
  }
  const wrong = files.find((f) => !fileMatchesAccept(f, tool.accept));
  if (wrong) return fail(415, `"${wrong.name}" isn't a supported file type for ${tool.name}.`);

  let opts: Record<string, string>;
  try {
    opts = sanitizeOptions(tool, JSON.parse(String(form.get("options") ?? "{}")));
  } catch (err) {
    return fail(400, err instanceof ToolError ? err.message : "Invalid options.");
  }

  const inputs: ServerInput[] = await Promise.all(
    files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );

  let outputs;
  try {
    outputs = await withJobSlot(() => runServerTool(tool, inputs, opts));
  } catch (err) {
    if (err instanceof ToolError) return fail(422, err.message);
    console.error(`[${tool.slug}]`, err);
    return fail(500, "Something went wrong while processing your file.");
  }
  if (outputs === null) return fail(503, "The server is busy. Try again in a minute.");

  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Notes": JSON.stringify(outputs.map((o) => o.note ?? "")).replace(/[^\x20-\x7e]/g, "?"),
  });

  if (outputs.length === 1) {
    const [o] = outputs;
    headers.set("Content-Type", o.name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    headers.set("Content-Disposition", contentDisposition(o.name));
    return new Response(o.bytes as BodyInit, { headers });
  }

  const zip = new JSZip();
  const used = new Set<string>();
  for (const o of outputs) {
    let name = o.name;
    for (let n = 2; used.has(name); n++) name = o.name.replace(/(\.[^.]+)?$/, `_${n}$1`);
    used.add(name);
    zip.file(name, o.bytes);
  }
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", contentDisposition(`${tool.slug}.zip`));
  headers.set("X-Bundle", "1");
  return new Response((await zip.generateAsync({ type: "uint8array" })) as BodyInit, { headers });
}
