import { Laptop, Server } from "lucide-react";
import type { Runtime } from "@/lib/tools";

export function RuntimeBadge({ runtime }: { runtime: Runtime }) {
  const local = runtime === "client";
  return (
    <span
      title={local ? "Runs in your browser. Files never leave your device." : "Processed on our server, then deleted."}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        local ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
      }`}
    >
      {local ? <Laptop size={12} /> : <Server size={12} />}
      {local ? "In browser" : "Server"}
    </span>
  );
}
