import { getFeed } from "@/lib/data";

export const dynamic = "force-static";

/** JSON feed for other clients and for the service worker's offline cache. */
export function GET() {
  return Response.json(getFeed());
}
