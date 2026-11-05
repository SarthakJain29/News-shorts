import { FeedApp } from "@/components/FeedApp";
import { getFeed } from "@/lib/data";

export default function Home() {
  const feed = getFeed();
  return <FeedApp shorts={feed.shorts} mode="feed" generatedAt={feed.generatedAt} dataMode={feed.mode} />;
}
