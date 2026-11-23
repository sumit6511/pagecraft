import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Pagecraft: PDF, document and image tools", template: "%s · Pagecraft" },
  description:
    "Merge, split, compress, convert, sign and protect PDFs, convert Office documents, and edit images. Most tools run right in your browser.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Logo />
              Pagecraft
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm text-muted">
              <Link href="/#organize" className="hidden rounded-md px-3 py-1.5 hover:bg-surface-2 hover:text-ink sm:block">
                PDF
              </Link>
              <Link href="/#convert" className="hidden rounded-md px-3 py-1.5 hover:bg-surface-2 hover:text-ink sm:block">
                Convert
              </Link>
              <Link href="/#image" className="hidden rounded-md px-3 py-1.5 hover:bg-surface-2 hover:text-ink sm:block">
                Images
              </Link>
              <Link href="/" className="rounded-md bg-brand px-3 py-1.5 font-medium text-brand-ink hover:opacity-90">
                All tools
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-8 text-sm text-muted">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
            <p>Pagecraft. Free PDF, document and image tools.</p>
            <p>
              Tools marked <span className="font-medium text-ink">In browser</span> never upload your files. Server tools
              delete files right after processing.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect x="5" y="3" width="18" height="24" rx="3" fill="var(--brand)" opacity="0.35" />
      <rect x="9" y="6" width="18" height="24" rx="3" fill="var(--brand)" />
      <path d="M13 14h10M13 18h10M13 22h6" stroke="var(--brand-ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
