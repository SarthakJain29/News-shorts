import type { Metadata } from "next";
import { FeedApp } from "@/components/FeedApp";
import { getFeed } from "@/lib/data";

export const metadata: Metadata = { title: "Catch me up in 3 minutes — News Shorts" };

export default function CatchUp() {
  const feed = getFeed();
  return <FeedApp shorts={feed.shorts} mode="catchup" generatedAt={feed.generatedAt} dataMode={feed.mode} />;
}
