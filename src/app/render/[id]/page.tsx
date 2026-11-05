import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RenderClient } from "@/components/RenderClient";
import { getFeed } from "@/lib/data";

export const metadata: Metadata = { title: "Render", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return getFeed().shorts.map((s) => ({ id: s.id }));
}

/** Frame-exact, chrome-less view of a short used by `npm run export:video`. */
export default async function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const short = getFeed().shorts.find((s) => s.id === decodeURIComponent(id));
  if (!short) notFound();
  return <RenderClient short={short} />;
}
