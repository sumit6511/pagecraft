import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RuntimeBadge } from "@/components/RuntimeBadge";
import { ToolIcon } from "@/components/ToolIcon";
import { ToolWorkspace } from "@/components/ToolWorkspace";
import { TOOLS, getTool } from "@/lib/tools";

export function generateStaticParams() {
  return TOOLS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/tools/[slug]">): Promise<Metadata> {
  const tool = getTool((await params).slug);
  return tool ? { title: tool.name, description: tool.summary } : {};
}

export default async function ToolPage({ params }: PageProps<"/tools/[slug]">) {
  const tool = getTool((await params).slug);
  if (!tool) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> All tools
      </Link>
      <div className="mb-8 flex items-start gap-4">
        <ToolIcon slug={tool.slug} category={tool.category} size={24} />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{tool.name}</h1>
            <RuntimeBadge runtime={tool.runtime} />
          </div>
          <p className="mt-1 text-muted">{tool.summary}</p>
        </div>
      </div>
      <ToolWorkspace slug={tool.slug} />
    </div>
  );
}
