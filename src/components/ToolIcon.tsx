import {
  Combine,
  Crop,
  EyeOff,
  FileImage,
  FileMinus,
  FileOutput,
  FileText,
  FileType,
  ImageDown,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockOpen,
  RefreshCw,
  RotateCw,
  Scaling,
  ScanText,
  Scissors,
  Shrink,
  Signature,
  Stamp,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/lib/tools";

const ICONS: Record<string, LucideIcon> = {
  "merge-pdf": Combine,
  "split-pdf": Scissors,
  "organize-pdf": LayoutGrid,
  "rotate-pdf": RotateCw,
  "remove-pages": FileMinus,
  "extract-pages": FileOutput,
  "pdf-to-image": FileImage,
  "image-to-pdf": FileType,
  "office-to-pdf": FileText,
  "pdf-to-word": FileText,
  "compress-image": ImageDown,
  "resize-image": Scaling,
  "convert-image": RefreshCw,
  "crop-image": Crop,
  "remove-metadata": EyeOff,
  "watermark-pdf": Stamp,
  "page-numbers": ListOrdered,
  "sign-pdf": Signature,
  "compress-pdf": Shrink,
  "protect-pdf": Lock,
  "unlock-pdf": LockOpen,
  "ocr-pdf": ScanText,
};

export const CATEGORY_COLOR: Record<Category, string> = {
  organize: "var(--cat-organize)",
  convert: "var(--cat-convert)",
  image: "var(--cat-image)",
  edit: "var(--cat-edit)",
  secure: "var(--cat-secure)",
};

export function ToolIcon({ slug, category, size = 22 }: { slug: string; category: Category; size?: number }) {
  const Icon = ICONS[slug] ?? FileText;
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        width: size * 2,
        height: size * 2,
      }}
      aria-hidden
    >
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}
