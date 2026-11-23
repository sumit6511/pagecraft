/** An error whose message is safe and useful to show to the user. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Parse a page-range expression such as "1-3, 5, 8-" into groups of 0-based
 * page indices. Each comma-separated part becomes one group. "8-" means "from
 * 8 to the last page"; "-3" means "from 1 to 3".
 */
export function parsePageGroups(input: string, total: number): number[][] {
  const parts = input
    .split(/[,;]/)
    .map((p) => p.replace(/\s+/g, ""))
    .filter(Boolean);
  if (parts.length === 0) throw new ToolError("Enter at least one page or range.");

  return parts.map((part) => {
    const m = /^(\d*)(?:(-)(\d*))?$/.exec(part);
    if (!m || (m[1] === "" && !m[2])) {
      throw new ToolError(`"${part}" isn't a valid page or range. Use forms like 3, 2-5 or 7-.`);
    }
    const start = m[1] === "" ? 1 : Number(m[1]);
    const end = m[2] ? (m[3] === "" ? total : Number(m[3])) : start;
    if (start < 1 || end < 1) throw new ToolError("Page numbers start at 1.");
    if (start > total || end > total) {
      throw new ToolError(`"${part}" is outside this document, which has ${total} page${total === 1 ? "" : "s"}.`);
    }
    if (start > end) throw new ToolError(`"${part}" runs backwards; write it as ${end}-${start}.`);
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  });
}

/** Unique, sorted 0-based page indices; empty input means every page. */
export function parsePageSet(input: string, total: number): number[] {
  if (!input.trim()) return Array.from({ length: total }, (_, i) => i);
  return [...new Set(parsePageGroups(input, total).flat())].sort((a, b) => a - b);
}

/** "report.final.pdf" → "report.final" */
export function baseName(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
