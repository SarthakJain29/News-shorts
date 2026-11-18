import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "News Shorts",
    short_name: "Shorts",
    description: "The news in 60-second narrated swipes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07070B",
    theme_color: "#07070B",
    categories: ["news", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Catch me up in 3 min", url: "/catch-up", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
