#!/usr/bin/env bash
# Generates the sample files tests/e2e.mjs uses.
# Needs: node (with this repo's node_modules), ImageMagick, LibreOffice.
set -euo pipefail
cd "$(dirname "$0")/.."
F=tests/.fixtures
mkdir -p "$F"

FIX="$F" node --input-type=module <<'JS'
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
  const p = doc.addPage([595, 842]);
  p.drawText(`Sample page ${i}`, { x: 60, y: 760, size: 32, font });
  p.drawRectangle({ x: 60, y: 400, width: 200, height: 120, color: rgb(0.2, 0.4, 0.9) });
  if (i === 3) p.setRotation(degrees(90)); // exercises rotated-page handling
}
writeFileSync(`${process.env.FIX}/sample.pdf`, await doc.save());

// A fillable form with document metadata, for Flatten and Edit metadata.
const form = await PDFDocument.create();
form.setTitle("Old title");
form.setAuthor("Old author");
const fp = form.addPage([595, 842]);
fp.drawText("Name:", { x: 60, y: 720, size: 14, font: await form.embedFont(StandardFonts.Helvetica) });
const field = form.getForm().createTextField("name");
field.setText("Ada Lovelace");
field.addToPage(fp, { x: 120, y: 712, width: 240, height: 24 });
writeFileSync(`${process.env.FIX}/form.pdf`, await form.save());

// sample.pdf with its cross-reference table destroyed, for Repair PDF.
const good = Buffer.from(await doc.save({ useObjectStreams: false }));
const cut = good.lastIndexOf("xref");
writeFileSync(`${process.env.FIX}/broken.pdf`, Buffer.concat([good.subarray(0, cut), Buffer.from("garbage\n%%EOF")]));
JS

cd "$F"
convert -size 1200x800 gradient:'#3366cc'-'#ffcc00' -pointsize 72 -fill white -annotate +100+400 'Photo test' photo.jpg
convert photo.jpg -set comment 'secret comment' photo_meta.jpg
convert -size 600x400 xc:white -pointsize 40 -fill black -annotate +40+200 'Scanned invoice 4417' scan.png
convert scan.png scan.pdf
convert -size 2400x3200 plasma:fractal -quality 95 big.jpg
convert big.jpg big.jpg big.jpg -quality 95 heavy.pdf
rm big.jpg
printf 'Quarterly report\n\nRevenue grew 12 percent.\n' > report.txt
printf '<html><body><h1>Hello HTML</h1><p>Converted by Pagecraft</p></body></html>' > page.html
soffice --headless --convert-to docx report.txt >/dev/null
echo "Fixtures written to $(pwd)"
