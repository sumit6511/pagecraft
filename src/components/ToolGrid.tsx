"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORIES, TOOLS, type Category } from "@/lib/tools";
import { RuntimeBadge } from "./RuntimeBadge";
import { ToolIcon } from "./ToolIcon";

export function ToolGrid() {
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOLS.filter(
      (t) =>
        (category === "all" || t.category === category) &&
        (!q || t.name.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)),
    );
  }, [category, query]);

  const grouped = CATEGORIES.map((c) => ({ ...c, tools: visible.filter((t) => t.category === c.id) })).filter(
    (g) => g.tools.length > 0,
  );

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tool categories">
          {[{ id: "all" as const, label: "All" }, ...CATEGORIES].map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                category === c.id
                  ? "border-ink bg-ink text-bg"
                  : "border-line-strong bg-surface text-muted hover:border-ink hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="relative sm:ml-auto sm:w-64">
          <span className="sr-only">Search tools</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools"
            className="field pl-9"
          />
        </label>
      </div>

      {grouped.length === 0 && <p className="py-16 text-center text-muted">No tools match “{query}”.</p>}

      <div className="flex flex-col gap-10">
        {grouped.map((g) => (
          <section key={g.id} id={g.id} className="scroll-mt-20">
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{g.label}</h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {g.tools.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/tools/${t.slug}`}
                    className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,0.25)]"
                  >
                    <div className="flex items-start justify-between">
                      <ToolIcon slug={t.slug} category={t.category} />
                      <RuntimeBadge runtime={t.runtime} />
                    </div>
                    <div>
                      <h3 className="font-semibold group-hover:text-brand">{t.name}</h3>
                      <p className="mt-1 text-sm leading-snug text-muted">{t.summary}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
