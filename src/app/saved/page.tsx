import type { Metadata } from "next";
import { SavedList } from "@/components/SavedList";
import { getFeed } from "@/lib/data";

export const metadata: Metadata = { title: "Saved — News Shorts" };

export default function Saved() {
  return <SavedList shorts={getFeed().shorts} />;
}
