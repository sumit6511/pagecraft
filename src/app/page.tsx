import { ToolGrid } from "@/components/ToolGrid";
import { TOOLS } from "@/lib/tools";

export default function Home() {
  const local = TOOLS.filter((t) => t.runtime === "client").length;
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <section className="mb-12 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Every tool for your PDFs, documents and images.
        </h1>
        <p className="mt-4 text-lg text-muted text-pretty">
          Merge, split, compress, convert, sign and protect, all free. {local} of {TOOLS.length} tools run entirely in
          your browser, so those files never leave your device.
        </p>
      </section>
      <ToolGrid />
    </div>
  );
}
