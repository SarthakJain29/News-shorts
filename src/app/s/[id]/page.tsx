import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedApp } from "@/components/FeedApp";
import { getFeed } from "@/lib/data";

export function generateStaticParams() {
  return getFeed().shorts.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = getFeed().shorts.find((x) => x.id === decodeURIComponent(id));
  return s ? { title: `${s.title} — News Shorts`, description: s.hook, openGraph: { title: s.title, description: s.hook } } : {};
}

export default async function SharedShort({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const feed = getFeed();
  const short = feed.shorts.find((x) => x.id === decodeURIComponent(id));
  if (!short) notFound();
  return <FeedApp shorts={feed.shorts} mode="single" startId={short.id} generatedAt={feed.generatedAt} dataMode={feed.mode} />;
}
