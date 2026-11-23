// Single source of truth for every tool: metadata, accepted inputs, options,
// and where it runs. Safe to import from both server and client code.

export type Category = "organize" | "convert" | "image" | "edit" | "secure";
export type Runtime = "client" | "server";
/** Tools that need a visual editor instead of (or alongside) plain fields. */
export type Editor = "organize" | "sign" | "crop";

export type Field =
  | {
      type: "select";
      name: string;
      label: string;
      options: { value: string; label: string }[];
      default: string;
      showIf?: Record<string, string[]>;
    }
  | {
      type: "text" | "password";
      name: string;
      label: string;
      placeholder?: string;
      default: string;
      required?: boolean;
      showIf?: Record<string, string[]>;
    }
  | {
      type: "number" | "range";
      name: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      default: string;
      suffix?: string;
      showIf?: Record<string, string[]>;
    }
  | {
      type: "color";
      name: string;
      label: string;
      default: string;
      showIf?: Record<string, string[]>;
    }
  | {
      type: "checkbox";
      name: string;
      label: string;
      default: "true" | "false";
      showIf?: Record<string, string[]>;
    };

export interface ToolDef {
  slug: string;
  name: string;
  /** Short line for cards. */
  summary: string;
  category: Category;
  runtime: Runtime;
  accept: string;
  multiple: boolean;
  minFiles: number;
  /** Let the user reorder files (order matters for the output). */
  orderable?: boolean;
  editor?: Editor;
  /** Fill the options from the chosen file (see prefillOptions in lib/client/run.ts). */
  prefill?: boolean;
  fields: Field[];
  action: string;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "organize", label: "Organize PDF" },
  { id: "convert", label: "Convert" },
  { id: "image", label: "Image tools" },
  { id: "edit", label: "Edit PDF" },
  { id: "secure", label: "Optimize & secure" },
];

export const ACCEPT = {
  pdf: "application/pdf,.pdf",
  image: "image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp",
  office:
    ".doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.html,.htm",
} as const;

const PAGES_FIELD: Field = {
  type: "text",
  name: "pages",
  label: "Pages",
  placeholder: "All pages, or e.g. 1-3, 5, 8-",
  default: "",
};

const IMAGE_SCAN = "image/jpeg,image/png,image/webp,image/tiff,image/bmp,.jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp";

const POSITION_OPTIONS = [
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

export const TOOLS: ToolDef[] = [
  // ── Organize ────────────────────────────────────────────────────────────
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    summary: "Combine several PDFs into one file, in the order you choose.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 2,
    orderable: true,
    fields: [],
    action: "Merge PDFs",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    summary: "Break a PDF into separate files by page ranges or every page.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "mode",
        label: "Split mode",
        default: "ranges",
        options: [
          { value: "ranges", label: "By ranges (one file per range)" },
          { value: "every", label: "Every page as its own file" },
          { value: "chunks", label: "Fixed number of pages per file" },
        ],
      },
      {
        type: "text",
        name: "ranges",
        label: "Ranges",
        placeholder: "e.g. 1-3, 4-6, 7-",
        default: "",
        required: true,
        showIf: { mode: ["ranges"] },
      },
      {
        type: "number",
        name: "chunk",
        label: "Pages per file",
        min: 1,
        max: 1000,
        default: "2",
        showIf: { mode: ["chunks"] },
      },
    ],
    action: "Split PDF",
  },
  {
    slug: "organize-pdf",
    name: "Organize PDF",
    summary: "Reorder, rotate and delete pages visually.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    editor: "organize",
    fields: [],
    action: "Save PDF",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    summary: "Rotate all pages, or just the ones you pick.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "angle",
        label: "Rotation",
        default: "90",
        options: [
          { value: "90", label: "90° clockwise" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° counter-clockwise" },
        ],
      },
      PAGES_FIELD,
    ],
    action: "Rotate",
  },
  {
    slug: "remove-pages",
    name: "Remove pages",
    summary: "Delete the pages you don't need from a PDF.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      { ...PAGES_FIELD, label: "Pages to remove", placeholder: "e.g. 2, 5-7", required: true } as Field,
    ],
    action: "Remove pages",
  },
  {
    slug: "extract-pages",
    name: "Extract pages",
    summary: "Pull selected pages out into a new PDF.",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      { ...PAGES_FIELD, label: "Pages to keep", placeholder: "e.g. 1, 3-4", required: true } as Field,
    ],
    action: "Extract pages",
  },
  {
    slug: "pages-per-sheet",
    name: "Pages per sheet",
    summary: "Print several pages on one sheet (2, 4, 6 or 9-up).",
    category: "organize",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "perSheet",
        label: "Pages per sheet",
        default: "2",
        options: [
          { value: "2", label: "2" },
          { value: "4", label: "4" },
          { value: "6", label: "6" },
          { value: "9", label: "9" },
        ],
      },
      {
        type: "select",
        name: "size",
        label: "Sheet size",
        default: "a4",
        options: [
          { value: "a4", label: "A4" },
          { value: "letter", label: "US Letter" },
        ],
      },
      {
        type: "select",
        name: "orientation",
        label: "Orientation",
        default: "auto",
        options: [
          { value: "auto", label: "Auto (largest pages)" },
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ],
      },
      { type: "checkbox", name: "border", label: "Draw a border around each page", default: "false" },
    ],
    action: "Create sheets",
  },

  // ── Convert ─────────────────────────────────────────────────────────────
  {
    slug: "pdf-to-image",
    name: "PDF to image",
    summary: "Turn every PDF page into a JPG or PNG image.",
    category: "convert",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "format",
        label: "Format",
        default: "jpg",
        options: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
        ],
      },
      {
        type: "select",
        name: "dpi",
        label: "Resolution",
        default: "150",
        options: [
          { value: "72", label: "Screen (72 DPI)" },
          { value: "150", label: "Standard (150 DPI)" },
          { value: "300", label: "Print (300 DPI)" },
        ],
      },
      PAGES_FIELD,
    ],
    action: "Convert to images",
  },
  {
    slug: "image-to-pdf",
    name: "Image to PDF",
    summary: "Put JPG, PNG and other images into a single PDF.",
    category: "convert",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    orderable: true,
    fields: [
      {
        type: "select",
        name: "size",
        label: "Page size",
        default: "fit",
        options: [
          { value: "fit", label: "Same as image" },
          { value: "a4", label: "A4" },
          { value: "letter", label: "US Letter" },
        ],
      },
      {
        type: "select",
        name: "orientation",
        label: "Orientation",
        default: "auto",
        options: [
          { value: "auto", label: "Auto" },
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ],
        showIf: { size: ["a4", "letter"] },
      },
      {
        type: "select",
        name: "margin",
        label: "Margin",
        default: "0",
        options: [
          { value: "0", label: "None" },
          { value: "18", label: "Small" },
          { value: "36", label: "Large" },
        ],
      },
    ],
    action: "Create PDF",
  },
  {
    slug: "office-to-pdf",
    name: "Office to PDF",
    summary: "Convert Word, Excel, PowerPoint, OpenDocument and HTML files to PDF.",
    category: "convert",
    runtime: "server",
    accept: ACCEPT.office,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Convert to PDF",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    summary: "Convert a PDF into an editable DOCX document.",
    category: "convert",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Convert to Word",
  },
  {
    slug: "pdf-to-text",
    name: "PDF to text",
    summary: "Extract the text of a PDF into a plain .txt file.",
    category: "convert",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      PAGES_FIELD,
      { type: "checkbox", name: "separators", label: "Mark where each page starts", default: "true" },
    ],
    action: "Extract text",
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF/A",
    summary: "Convert to PDF/A-2b for long-term archiving.",
    category: "convert",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Convert to PDF/A",
  },
  {
    slug: "image-to-text",
    name: "Image to text",
    summary: "Read the text in photos and screenshots (OCR).",
    category: "convert",
    runtime: "server",
    accept: IMAGE_SCAN,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "language",
        label: "Text language",
        default: "eng",
        options: [{ value: "eng", label: "English" }],
      },
    ],
    action: "Extract text",
  },

  // ── Image ───────────────────────────────────────────────────────────────
  {
    slug: "compress-image",
    name: "Compress image",
    summary: "Shrink JPG, PNG and WebP files with adjustable quality.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "range",
        name: "quality",
        label: "Quality",
        min: 10,
        max: 95,
        step: 5,
        default: "70",
        suffix: "%",
      },
      {
        type: "select",
        name: "format",
        label: "Output format",
        default: "keep",
        options: [
          { value: "keep", label: "Keep original (PNG → WebP)" },
          { value: "jpg", label: "JPG" },
          { value: "webp", label: "WebP" },
        ],
      },
    ],
    action: "Compress images",
  },
  {
    slug: "resize-image",
    name: "Resize image",
    summary: "Change dimensions by pixels or percentage.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "mode",
        label: "Resize by",
        default: "percent",
        options: [
          { value: "percent", label: "Percentage" },
          { value: "pixels", label: "Pixels" },
        ],
      },
      {
        type: "range",
        name: "percent",
        label: "Scale",
        min: 5,
        max: 200,
        step: 5,
        default: "50",
        suffix: "%",
        showIf: { mode: ["percent"] },
      },
      {
        type: "number",
        name: "width",
        label: "Width",
        min: 1,
        max: 20000,
        default: "1280",
        suffix: "px",
        showIf: { mode: ["pixels"] },
      },
      {
        type: "number",
        name: "height",
        label: "Height",
        min: 0,
        max: 20000,
        default: "0",
        suffix: "px (0 = auto)",
        showIf: { mode: ["pixels"] },
      },
    ],
    action: "Resize images",
  },
  {
    slug: "convert-image",
    name: "Convert image",
    summary: "Convert between JPG, PNG and WebP.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "format",
        label: "Convert to",
        default: "png",
        options: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
        ],
      },
    ],
    action: "Convert images",
  },
  {
    slug: "crop-image",
    name: "Crop image",
    summary: "Drag to select the part of an image you want to keep.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: false,
    minFiles: 1,
    editor: "crop",
    fields: [],
    action: "Crop image",
  },
  {
    slug: "rotate-image",
    name: "Rotate & flip image",
    summary: "Turn images by 90° steps or mirror them.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "angle",
        label: "Rotate",
        default: "90",
        options: [
          { value: "0", label: "Don't rotate" },
          { value: "90", label: "90° clockwise" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° counter-clockwise" },
        ],
      },
      {
        type: "select",
        name: "flip",
        label: "Flip",
        default: "none",
        options: [
          { value: "none", label: "Don't flip" },
          { value: "horizontal", label: "Horizontally (mirror)" },
          { value: "vertical", label: "Vertically" },
        ],
      },
    ],
    action: "Apply",
  },
  {
    slug: "watermark-image",
    name: "Watermark image",
    summary: "Stamp text on your photos and graphics.",
    category: "image",
    runtime: "client",
    accept: ACCEPT.image,
    multiple: true,
    minFiles: 1,
    fields: [
      { type: "text", name: "text", label: "Watermark text", default: "© Your name", required: true },
      {
        type: "select",
        name: "position",
        label: "Position",
        default: "bottom-right",
        options: [
          { value: "diagonal", label: "Diagonal, centered" },
          { value: "center", label: "Centered" },
          { value: "tile", label: "Tiled across the image" },
          ...POSITION_OPTIONS,
        ],
      },
      { type: "range", name: "size", label: "Text size", min: 2, max: 20, step: 1, default: "5", suffix: "% of width" },
      { type: "range", name: "opacity", label: "Opacity", min: 10, max: 100, step: 5, default: "60", suffix: "%" },
      { type: "color", name: "color", label: "Color", default: "#ffffff" },
    ],
    action: "Add watermark",
  },
  {
    slug: "remove-metadata",
    name: "Remove image metadata",
    summary: "Strip EXIF data such as GPS location and camera details.",
    category: "image",
    runtime: "client",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Remove metadata",
  },

  // ── Edit ────────────────────────────────────────────────────────────────
  {
    slug: "watermark-pdf",
    name: "Add watermark",
    summary: "Stamp text across your PDF pages.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      { type: "text", name: "text", label: "Watermark text", default: "CONFIDENTIAL", required: true },
      {
        type: "select",
        name: "position",
        label: "Position",
        default: "diagonal",
        options: [
          { value: "diagonal", label: "Diagonal, centered" },
          { value: "center", label: "Centered" },
          ...POSITION_OPTIONS,
        ],
      },
      { type: "range", name: "size", label: "Font size", min: 12, max: 120, step: 2, default: "56", suffix: "pt" },
      { type: "range", name: "opacity", label: "Opacity", min: 5, max: 100, step: 5, default: "25", suffix: "%" },
      { type: "color", name: "color", label: "Color", default: "#d92d20" },
      PAGES_FIELD,
    ],
    action: "Add watermark",
  },
  {
    slug: "page-numbers",
    name: "Add page numbers",
    summary: "Number your PDF pages with your choice of position and style.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      { type: "select", name: "position", label: "Position", default: "bottom-center", options: POSITION_OPTIONS },
      {
        type: "select",
        name: "format",
        label: "Format",
        default: "n",
        options: [
          { value: "n", label: "1" },
          { value: "page-n", label: "Page 1" },
          { value: "n-of-total", label: "1 / 12" },
          { value: "page-n-of-total", label: "Page 1 of 12" },
        ],
      },
      { type: "number", name: "start", label: "First number", min: 0, max: 100000, default: "1" },
      { type: "range", name: "size", label: "Font size", min: 6, max: 36, step: 1, default: "11", suffix: "pt" },
      { type: "checkbox", name: "skipFirst", label: "Skip the first page", default: "false" },
    ],
    action: "Add page numbers",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    summary: "Draw your signature and place it on a page.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    editor: "sign",
    fields: [],
    action: "Apply signature",
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    summary: "Trim the margins of PDF pages.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      { type: "number", name: "top", label: "Top", min: 0, max: 500, default: "10", suffix: "mm" },
      { type: "number", name: "bottom", label: "Bottom", min: 0, max: 500, default: "10", suffix: "mm" },
      { type: "number", name: "left", label: "Left", min: 0, max: 500, default: "10", suffix: "mm" },
      { type: "number", name: "right", label: "Right", min: 0, max: 500, default: "10", suffix: "mm" },
      PAGES_FIELD,
    ],
    action: "Crop pages",
  },
  {
    slug: "flatten-pdf",
    name: "Flatten PDF forms",
    summary: "Lock filled-in form fields so they can't be edited.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Flatten forms",
  },
  {
    slug: "edit-metadata",
    name: "Edit PDF metadata",
    summary: "Change or remove the title, author and other document properties.",
    category: "edit",
    runtime: "client",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    prefill: true,
    fields: [
      { type: "text", name: "title", label: "Title", placeholder: "Empty removes it", default: "" },
      { type: "text", name: "author", label: "Author", placeholder: "Empty removes it", default: "" },
      { type: "text", name: "subject", label: "Subject", placeholder: "Empty removes it", default: "" },
      { type: "text", name: "keywords", label: "Keywords", placeholder: "Comma-separated", default: "" },
      {
        type: "checkbox",
        name: "stripTech",
        label: "Also remove creator app, producer and dates",
        default: "false",
      },
    ],
    action: "Save metadata",
  },

  // ── Optimize & secure ───────────────────────────────────────────────────
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    summary: "Reduce PDF file size by recompressing images and streams.",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "level",
        label: "Compression",
        default: "ebook",
        options: [
          { value: "screen", label: "Strong (smallest, 72 DPI images)" },
          { value: "ebook", label: "Recommended (150 DPI images)" },
          { value: "printer", label: "Light (300 DPI images)" },
        ],
      },
    ],
    action: "Compress PDF",
  },
  {
    slug: "grayscale-pdf",
    name: "Grayscale PDF",
    summary: "Convert every page to black and white to save ink.",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Convert to grayscale",
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    summary: "Recover damaged or corrupted PDF files.",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [],
    action: "Repair PDF",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    summary: "Encrypt a PDF with a password (AES-256).",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      { type: "password", name: "password", label: "Password", default: "", required: true },
      { type: "password", name: "confirm", label: "Confirm password", default: "", required: true },
    ],
    action: "Protect PDF",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    summary: "Remove the password from a PDF you're allowed to open.",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: true,
    minFiles: 1,
    fields: [
      {
        type: "password",
        name: "password",
        label: "Current password",
        placeholder: "Leave empty if it only has an owner password",
        default: "",
      },
    ],
    action: "Unlock PDF",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    summary: "Make scanned PDFs searchable and selectable.",
    category: "secure",
    runtime: "server",
    accept: ACCEPT.pdf,
    multiple: false,
    minFiles: 1,
    fields: [
      {
        type: "select",
        name: "language",
        label: "Document language",
        default: "eng",
        options: [{ value: "eng", label: "English" }],
      },
      {
        type: "checkbox",
        name: "force",
        label: "Re-OCR pages that already have text",
        default: "false",
      },
    ],
    action: "Run OCR",
  },
];

export function getTool(slug: string): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

/** Default option values for a tool. */
export function defaultOptions(tool: ToolDef): Record<string, string> {
  return Object.fromEntries(tool.fields.map((f) => [f.name, f.default]));
}

export function isFieldVisible(field: Field, values: Record<string, string>) {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([k, allowed]) => allowed.includes(values[k]));
}

/** True when `file` matches an `accept` string (MIME types and extensions). */
export function fileMatchesAccept(file: { name: string; type: string }, accept: string) {
  const name = file.name.toLowerCase();
  return accept.split(",").some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith(".")) return name.endsWith(a);
    if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -1));
    return file.type === a;
  });
}
