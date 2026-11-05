"use client";
import dynamic from "next/dynamic";
import type { Short } from "@/lib/types";

const RenderStage = dynamic(() => import("./RenderStage"), { ssr: false });

export function RenderClient({ short }: { short: Short }) {
  return <RenderStage short={short} />;
}
