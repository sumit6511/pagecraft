// End-to-end check of every browser-side tool, plus server tools via the UI.
// Usage: tests/make-fixtures.sh, start the app, then BASE=http://localhost:3000 npm run test:e2e
// Needs Playwright with Chromium, plus poppler-utils, ImageMagick and unzip for verification.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { PDFDocument } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FX = path.join(ROOT, "tests/.fixtures");
const OUT = path.join(ROOT, "tests/.output");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(["PASS", name, detail ?? ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
    await page.screenshot({ path: `${OUT}/${name}.fail.png` });
  }
}
const pdfInfo = async (file) => {
  const d = await PDFDocument.load(readFileSync(file));
  return { pages: d.getPageCount(), rot: d.getPages().map((p) => p.getRotation().angle) };
};
const identify = (file) => execFileSync("identify", ["-format", "%m %wx%h", file]).toString();

async function open(slug, files) {
  await page.goto(`${BASE}/tools/${slug}`);
  await page.locator('input[type=file]').first().setInputFiles(files.map((f) => `${FX}/${f}`));
}
async function runAndDownload(actionName, { zip = false } = {}) {
  await page.getByRole("button", { name: actionName, exact: true }).click();
  await page.getByRole("heading", { name: "Done!" }).waitFor({ timeout: 60_000 });
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: zip ? /Download all/ : /^Download / }).click(),
  ]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}
const setField = (label, value) => page.getByLabel(label, { exact: true }).fill(value);
const selectField = (label, value) => page.getByLabel(label, { exact: true }).selectOption(value);

await check("home", async () => {
  await page.goto(BASE);
  const n = await page.locator('a[href^="/tools/"]').count();
  if (n !== 22) throw new Error(`expected 22 tool cards, got ${n}`);
  await page.getByPlaceholder("Search tools").fill("sign");
  const m = await page.locator('a[href^="/tools/"]').count();
  if (m !== 1) throw new Error(`search: expected 1, got ${m}`);
  return `${n} cards, search ok`;
});

await check("merge-pdf", async () => {
  await open("merge-pdf", ["sample.pdf", "scan.pdf"]);
  const f = await runAndDownload("Merge PDFs");
  const i = await pdfInfo(f);
  if (i.pages !== 4) throw new Error(`pages=${i.pages}`);
  return `4 pages`;
});

await check("split-pdf ranges", async () => {
  await open("split-pdf", ["sample.pdf"]);
  await setField("Ranges", "1-2, 3");
  const f = await runAndDownload("Split PDF", { zip: true });
  const list = execFileSync("unzip", ["-Z1", f]).toString().trim().split("\n");
  if (list.length !== 2) throw new Error(list.join(","));
  return list.join(", ");
});

await check("split-pdf bad range error", async () => {
  await open("split-pdf", ["sample.pdf"]);
  await setField("Ranges", "2-9");
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  const msg = await page.getByText(/outside this document/).textContent({ timeout: 5000 });
  return msg;
});

await check("rotate-pdf", async () => {
  await open("rotate-pdf", ["sample.pdf"]);
  await setField("Pages", "1");
  const f = await runAndDownload("Rotate");
  const i = await pdfInfo(f);
  if (i.rot.join() !== "90,0,90") throw new Error(i.rot.join());
  return `rotations ${i.rot}`;
});

await check("remove-pages", async () => {
  await open("remove-pages", ["sample.pdf"]);
  await setField("Pages to remove", "2");
  const i = await pdfInfo(await runAndDownload("Remove pages"));
  if (i.pages !== 2) throw new Error(`pages=${i.pages}`);
  return "2 pages left";
});

await check("extract-pages", async () => {
  await open("extract-pages", ["sample.pdf"]);
  await setField("Pages to keep", "3, 1");
  const i = await pdfInfo(await runAndDownload("Extract pages"));
  if (i.pages !== 2 || i.rot[0] !== 90) throw new Error(JSON.stringify(i));
  return "order 3,1 kept";
});

await check("organize-pdf", async () => {
  await open("organize-pdf", ["sample.pdf"]);
  await page.getByAltText("Page 1").waitFor();
  await page.getByAltText("Page 3").waitFor();
  await page.screenshot({ path: `${OUT}/organize.png` });
  await page.getByRole("button", { name: "Delete page" }).nth(1).click(); // delete page 2
  await page.getByRole("button", { name: "Rotate right" }).first().click(); // rotate page 1
  await page.getByRole("button", { name: "Move earlier" }).nth(1).click(); // move page 3 first
  const i = await pdfInfo(await runAndDownload("Save PDF"));
  if (i.pages !== 2 || i.rot.join() !== "90,90") throw new Error(JSON.stringify(i));
  return "deleted, rotated, reordered";
});

await check("pdf-to-image", async () => {
  await open("pdf-to-image", ["sample.pdf"]);
  await selectField("Format", "png");
  const f = await runAndDownload("Convert to images", { zip: true });
  const list = execFileSync("unzip", ["-Z1", f]).toString().trim().split("\n");
  execFileSync("unzip", ["-o", "-q", f, "-d", `${OUT}/p2i`]);
  return `${list.length} images; p1 ${identify(`${OUT}/p2i/${list[0]}`)}; p3 ${identify(`${OUT}/p2i/${list[2]}`)}`;
});

await check("image-to-pdf", async () => {
  await open("image-to-pdf", ["photo.jpg", "scan.png"]);
  await selectField("Page size", "a4");
  const i = await pdfInfo(await runAndDownload("Create PDF"));
  if (i.pages !== 2) throw new Error(`pages=${i.pages}`);
  return "2 pages";
});

await check("compress-image", async () => {
  await open("compress-image", ["photo.jpg"]);
  const f = await runAndDownload("Compress images");
  return `${readFileSync(`${FX}/photo.jpg`).length} → ${readFileSync(f).length} bytes (${identify(f)})`;
});

await check("resize-image", async () => {
  await open("resize-image", ["photo.jpg"]);
  await selectField("Resize by", "pixels");
  await setField("Width", "300");
  const f = await runAndDownload("Resize images");
  const id = identify(f);
  if (!id.includes("300x200")) throw new Error(id);
  return id;
});

await check("convert-image", async () => {
  await open("convert-image", ["photo.jpg"]);
  await selectField("Convert to", "webp");
  const f = await runAndDownload("Convert images");
  const id = identify(f);
  if (!id.startsWith("WEBP")) throw new Error(id);
  return id;
});

await check("crop-image", async () => {
  await open("crop-image", ["photo.jpg"]);
  await page.getByRole("button", { name: "1:1", exact: true }).click();
  await page.screenshot({ path: `${OUT}/crop.png` });
  const f = await runAndDownload("Crop image");
  const id = identify(f);
  const [w, h] = id.split(" ")[1].split("x").map(Number);
  if (Math.abs(w - h) > 2) throw new Error(id);
  return id;
});

await check("remove-metadata", async () => {
  await open("remove-metadata", ["photo_meta.jpg"]);
  const f = await runAndDownload("Remove metadata");
  const before = execFileSync("identify", ["-format", "%c", `${FX}/photo_meta.jpg`]).toString();
  const after = execFileSync("identify", ["-format", "%c", f]).toString();
  if (!before.includes("secret") || after.includes("secret")) throw new Error(`before=${before} after=${after}`);
  return `comment removed (${readFileSync(`${FX}/photo_meta.jpg`).length} → ${readFileSync(f).length} bytes)`;
});

await check("watermark-pdf", async () => {
  await open("watermark-pdf", ["sample.pdf"]);
  const f = await runAndDownload("Add watermark");
  // Diagonal text extracts as fragments (scrambled on rotated pages), so compare letters.
  let n = 0;
  for (const pg of [1, 2, 3]) {
    const t = execFileSync("pdftotext", ["-f", String(pg), "-l", String(pg), f, "-"]).toString();
    const letters = t.replace(/Sample page \d/, "").replace(/[^A-Z]/g, "").split("").sort().join("");
    if (letters === "CONFIDENTIAL".split("").sort().join("")) n++;
  }
  if (n !== 3) throw new Error(`found ${n}`);
  execFileSync("pdftoppm", ["-png", "-r", "40", f, `${OUT}/wm`]);
  return "on 3 pages";
});

await check("page-numbers", async () => {
  await open("page-numbers", ["sample.pdf"]);
  await selectField("Format", "page-n-of-total");
  const f = await runAndDownload("Add page numbers");
  const text = execFileSync("pdftotext", [f, "-"]).toString();
  if (!text.includes("Page 3 of 3")) throw new Error(text.slice(0, 200));
  execFileSync("pdftoppm", ["-png", "-r", "40", f, `${OUT}/pn`]);
  return "Page 1 of 3 … Page 3 of 3";
});

await check("sign-pdf", async () => {
  await open("sign-pdf", ["sample.pdf"]);
  const pad = page.locator("canvas");
  await pad.waitFor();
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + 40, b.y + 120);
  await page.mouse.down();
  for (let k = 0; k <= 30; k++) await page.mouse.move(b.x + 40 + k * 12, b.y + 120 - Math.sin(k / 3) * 40);
  await page.mouse.up();
  await page.getByRole("button", { name: "Use this signature" }).click();
  await page.getByRole("button", { name: /Place on page 1/ }).click();
  // Also sign the rotated page 3.
  await page.getByRole("button", { name: "Page 3" }).first().click();
  await page.getByRole("button", { name: /Place on page 3/ }).click();
  await page.screenshot({ path: `${OUT}/sign.png` });
  const f = await runAndDownload("Apply signature");
  execFileSync("pdftoppm", ["-png", "-r", "40", f, `${OUT}/signed`]);
  const imgs = execFileSync("pdfimages", ["-list", f]).toString().trim().split("\n").length - 2;
  if (imgs < 2) throw new Error(`images=${imgs}`);
  return `${imgs} signature placements`;
});

await check("compress-pdf (server via UI)", async () => {
  await open("compress-pdf", ["heavy.pdf"]);
  const f = await runAndDownload("Compress PDF");
  const note = await page.getByText(/smaller/).first().textContent();
  return `${readFileSync(`${FX}/heavy.pdf`).length} → ${readFileSync(f).length} (${note.trim()})`;
});

await check("protect-pdf mismatch blocks", async () => {
  await open("protect-pdf", ["sample.pdf"]);
  await setField("Password", "abcd1");
  await setField("Confirm password", "abcd2");
  const disabled = await page.getByRole("button", { name: "Protect PDF", exact: true }).isDisabled();
  if (!disabled) throw new Error("button enabled");
  return "button disabled with hint";
});

await check("mobile home", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: `${OUT}/mobile-home.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  if (sw > 390) throw new Error(`horizontal scroll: ${sw}`);
  return "no horizontal scroll";
});

await page.goto(BASE);
await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });
await page.emulateMedia({ colorScheme: "dark" });
await page.screenshot({ path: `${OUT}/home-dark.png` });

await browser.close();
for (const [s, n, d] of results) console.log(`${s}  ${n.padEnd(30)} ${d}`);
console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
if (consoleErrors.length) console.log("Console errors:\n" + [...new Set(consoleErrors)].join("\n"));
process.exit(results.every((r) => r[0] === "PASS") ? 0 : 1);
