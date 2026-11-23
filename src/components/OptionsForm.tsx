"use client";

import { isFieldVisible, type Field } from "@/lib/tools";

interface Props {
  fields: Field[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

export function OptionsForm({ fields, values, onChange }: Props) {
  const visible = fields.filter((f) => isFieldVisible(f, values));
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {visible.map((f) => {
        const id = `opt-${f.name}`;
        const v = values[f.name] ?? f.default;
        if (f.type === "checkbox") {
          return (
            <label key={f.name} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v === "true"}
                onChange={(e) => onChange(f.name, String(e.target.checked))}
                className="size-4 accent-[var(--brand)]"
              />
              {f.label}
            </label>
          );
        }
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="flex items-center justify-between text-sm font-medium">
              {f.label}
              {f.type === "range" && (
                <span className="font-mono text-xs text-muted">
                  {v}
                  {f.suffix}
                </span>
              )}
            </label>
            {f.type === "select" ? (
              <select id={id} value={v} onChange={(e) => onChange(f.name, e.target.value)} className="field">
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "range" ? (
              <input
                id={id}
                type="range"
                min={f.min}
                max={f.max}
                step={f.step ?? 1}
                value={v}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="accent-[var(--brand)]"
              />
            ) : f.type === "color" ? (
              <input
                id={id}
                type="color"
                value={v}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="h-10 w-20 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
              />
            ) : f.type === "number" ? (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={v}
                  onChange={(e) => onChange(f.name, e.target.value)}
                  className="field"
                />
                {f.suffix && <span className="shrink-0 text-xs text-muted">{f.suffix}</span>}
              </div>
            ) : (
              <input
                id={id}
                type={f.type}
                value={v}
                placeholder={"placeholder" in f ? f.placeholder : undefined}
                autoComplete={f.type === "password" ? "new-password" : "off"}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="field"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
