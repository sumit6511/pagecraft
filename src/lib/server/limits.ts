import "server-only";

export const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1024 * 1024;
export const MAX_FILES = Number(process.env.MAX_FILES) || 20;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS) || 2;
const MAX_QUEUE = Number(process.env.MAX_QUEUED_JOBS) || 20;
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

// ── Concurrency: heavy CLI jobs share the CPU, so queue beyond a few. ───────

let active = 0;
const waiting: (() => void)[] = [];

/** Run `fn` when a job slot is free; returns null if the queue is full. */
export async function withJobSlot<T>(fn: () => Promise<T>): Promise<T | null> {
  if (active >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUE) return null;
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ── Per-client rate limit (in-memory; use a shared store if you scale out). ─

const hits = new Map<string, number[]>();

export function rateLimited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_PER_MIN) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k);
  }
  return false;
}

export function clientKey(headers: Headers) {
  // Only trust X-Forwarded-For when you run behind a proxy you control.
  const xff = process.env.TRUST_PROXY === "1" ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return xff || headers.get("x-real-ip") || "local";
}
