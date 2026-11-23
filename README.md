# Pagecraft

Free, self-hostable PDF, document and image tools. Merge, split, compress, convert,
sign and protect PDFs, turn Office files into PDFs, and edit images.

**23 of the 33 tools run entirely in the browser**, so those files never leave the user's
device. The other 10 need native software (LibreOffice, Ghostscript, qpdf, OCRmyPDF,
Tesseract) and run on the server; uploads are processed in a private temp folder and
deleted immediately.

## Tools

| Group | Tool | Runs in | Engine |
| --- | --- | --- | --- |
| Organize | Merge PDF, Split PDF, Organize PDF (visual reorder/rotate/delete), Rotate PDF, Remove pages, Extract pages, Pages per sheet (2/4/6/9-up) | Browser | pdf-lib, pdf.js |
| Convert | PDF → image (JPG/PNG/WebP), Image → PDF, PDF → text | Browser | pdf.js, pdf-lib |
| Convert | Office → PDF (Word, Excel, PowerPoint, OpenDocument, RTF, TXT, CSV, HTML) | Server | LibreOffice |
| Convert | PDF → Word (DOCX) | Server | LibreOffice |
| Convert | PDF → PDF/A-2b | Server | OCRmyPDF + Ghostscript |
| Convert | Image → text (OCR) | Server | Tesseract |
| Image | Compress, Resize, Convert (JPG/PNG/WebP), Crop (visual), Rotate & flip, Watermark (single, diagonal or tiled), Remove metadata (lossless EXIF/XMP strip) | Browser | Canvas |
| Edit | Watermark, Page numbers, Sign PDF (draw or type, drag to place), Crop PDF margins, Flatten forms, Edit metadata | Browser | pdf-lib |
| Optimize & secure | Compress PDF, Grayscale PDF | Server | Ghostscript |
| Optimize & secure | Repair PDF | Server | qpdf, Ghostscript fallback |
| Optimize & secure | Protect PDF (AES-256), Unlock PDF | Server | qpdf |
| Optimize & secure | OCR PDF (searchable scans) | Server | OCRmyPDF + Tesseract |

Rotated pages are handled correctly: watermarks, page numbers, signatures, crop margins and
pages-per-sheet layouts follow what the reader sees, not the page's internal coordinates.

## Run it

### Docker (recommended)

The image bundles Node and every converter.

```bash
docker compose up --build
```

Open http://localhost:3000. `GET /api/health` reports which converters are available.

### Local development

Needs Node.js 22+. The browser tools work with nothing else. For the server tools, install
the converters (Debian/Ubuntu shown):

```bash
sudo apt-get install libreoffice-writer libreoffice-calc libreoffice-impress ghostscript qpdf ocrmypdf tesseract-ocr-eng
```

```bash
npm install
npm run dev
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | `100` | Total upload size per request to server tools |
| `MAX_FILES` | `20` | Files per request |
| `MAX_CONCURRENT_JOBS` | `2` | Server conversions running at once; more are queued |
| `MAX_QUEUED_JOBS` | `20` | Queue length before the server answers "busy" |
| `RATE_LIMIT_PER_MIN` | `20` | Server-tool requests per client per minute |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy you control, to rate-limit by `X-Forwarded-For` |
| `SOFFICE_BIN`, `GS_BIN`, `QPDF_BIN`, `OCRMYPDF_BIN`, `TESSERACT_BIN` | on `PATH` | Override converter locations |

## How it's built

- **Next.js 16** (App Router, Cache Components, standalone output), **TypeScript**, **Tailwind CSS 4**.
- `src/lib/tools.ts` is the single registry. Every tool's name, category, accepted files,
  options and where it runs. Pages, the home grid, the options form and server-side option
  validation are all generated from it.
- `src/lib/client/`: browser implementations (`pdf.ts`, `images.ts`, pdf.js rendering in `render.ts`).
- `src/lib/server/`: server implementations. Converters are started with `execFile` (no shell),
  each job gets its own temp directory that is always removed, and passwords reach qpdf
  through a `0600` argument file so they never appear in the process list.
- `src/app/api/tools/[slug]/route.ts`: one endpoint for all server tools, with size, count,
  type, option, rate and concurrency checks.
- `src/components/ToolWorkspace.tsx`: the shared drop → options → run → download flow;
  `components/editors/` holds the visual Organize, Sign and Crop editors.

### Adding a tool

1. Add an entry to `TOOLS` in `src/lib/tools.ts` (fields become the options form automatically).
2. Implement it in `src/lib/client/run.ts` (browser) or `src/lib/server/run.ts` (server).
3. Add an icon in `src/components/ToolIcon.tsx`.

### Adding OCR languages

Install the Tesseract language pack (for example `tesseract-ocr-deu`), then add the code to
the `language` options of the OCR PDF and Image to text tools in `tools.ts`, and to
`OCR_LANGS` in `src/lib/server/run.ts`.

## Testing

```bash
npm run typecheck && npm run lint
```

End-to-end: generates sample files, then drives every tool in Chromium and checks each
output (page counts, rotation, dimensions, extracted text, metadata). Every PDF produced must
also open in poppler without warnings. Needs Playwright with
Chromium, ImageMagick, poppler-utils and LibreOffice.

```bash
npm run test:fixtures
```

```bash
BASE=http://localhost:3000 npm run test:e2e
```

## Known limits

- **PDF → Word** uses LibreOffice's PDF import. Text and simple layouts convert well;
  complex multi-column layouts may need touch-ups.
- **Browser image tools** are limited by canvas size (about 16 megapixels in Safari).
- **Rate limiting and the job queue are in memory**, so they apply per instance. Use a shared
  store (e.g. Redis) if you run several instances.
- The built-in PDF fonts cover Latin text; watermark text in other scripts is rejected with a
  clear message rather than drawn incorrectly.
