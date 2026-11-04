/**
 * News Shorts pipeline: RSS → dedupe/cluster → original scripts (LLM) → narration (TTS) → data/shorts.json
 *
 *   npm run pipeline                 # live: feeds + LLM + TTS
 *   npm run pipeline -- --no-tts     # skip narration (app falls back to Web Speech)
 *   npm run pipeline -- --tracks=tech,science --max=2
 *   npm run pipeline:mock            # live feeds, deterministic offline writer, no API calls
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TRACK_IDS, type Short, type ShortsFeed, type TrackId } from "../src/lib/types";
import { cluster, dedupe, sameStory, type Cluster } from "./cluster";
import { FEEDS } from "./feeds";
import { completeWithFallback, providerChain } from "./llm";
import { fetchFeed, type RawItem } from "./rss";
import { buildPrompt, draftToShort, extractJson, mockShort } from "./script";
import { synthesize } from "./tts";

function loadDotEnv() {
  const f = path.join(process.cwd(), ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);

const OUT = path.join(process.cwd(), "data", "shorts.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ingest(track: TrackId): Promise<RawItem[]> {
  const results = await Promise.allSettled(FEEDS[track].map((f) => fetchFeed(f.url, f.outlet)));
  const items: RawItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value.slice(0, 25));
    else console.warn(`  ! ${track}/${FEEDS[track][i].outlet}: ${(r.reason as Error).message}`);
  });
  const fresh = items.filter((it) => Date.now() - Date.parse(it.publishedAt) < 3 * 86400e3);
  return dedupe(fresh.length >= 6 ? fresh : items);
}

function readExisting(): Map<string, Short> {
  try {
    const feed = JSON.parse(readFileSync(OUT, "utf8")) as ShortsFeed;
    return new Map(feed.shorts.map((s) => [s.id, s]));
  } catch {
    return new Map();
  }
}

async function writeScript(track: TrackId, c: Cluster, mock: boolean): Promise<Short> {
  const chain = mock ? [] : providerChain();
  if (chain.length === 0) return mockShort(track, c);
  const prompt = buildPrompt(track, c);
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await completeWithFallback(chain, { ...prompt, user: prompt.user + feedback, json: true, temperature: 0.55 + attempt * 0.1 });
      return draftToShort(extractJson(res.text), track, c, res.provider as Short["provider"]);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      console.warn(`  ! script attempt ${attempt + 1}: ${msg}`);
      feedback = `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${msg}. Fix this. Rephrase everything in fresh words.`;
      await sleep(1500);
    }
  }
  console.warn("  ! falling back to offline writer");
  return mockShort(track, c);
}

async function main() {
  loadDotEnv();
  const mock = args.has("mock");
  const noTts = args.has("no-tts") || mock || (process.env.TTS_PROVIDER ?? "gemini") === "none";
  const maxPerTrack = Number(args.get("max") ?? process.env.PIPELINE_MAX_STORIES_PER_TRACK ?? 4);
  const ttsBudget = Number(process.env.TTS_MAX_PER_RUN ?? 10);
  const wanted = args.get("tracks")?.split(",") ?? [...TRACK_IDS];
  const tracks = TRACK_IDS.filter((t) => wanted.some((w) => t.startsWith(w)));
  const existing = readExisting();
  const chain = providerChain();
  console.log(`News Shorts pipeline — tracks: ${tracks.join(", ")} | writer: ${mock || !chain.length ? "offline mock" : chain.map((p) => `${p.name}:${p.model}`).join(" → ")} | tts: ${noTts ? "off" : `gemini (budget ${ttsBudget})`}`);

  const picked: { track: TrackId; c: Cluster }[] = [];
  for (const track of tracks) {
    const items = await ingest(track);
    const clusters = cluster(items);
    let n = 0;
    for (const c of clusters) {
      if (n >= maxPerTrack) break;
      if (picked.some((p) => sameStory(p.c, c))) continue;
      picked.push({ track, c });
      n++;
    }
    console.log(`• ${track}: ${items.length} items → ${clusters.length} clusters → ${n} picked (${clusters.slice(0, n).map((c) => c.outlets.length).join("/")} outlets)`);
  }
  if (picked.length === 0) {
    console.error("No stories ingested (network down?). Keeping existing data/shorts.json.");
    return;
  }

  const shorts: Short[] = [];
  for (const { track, c } of picked) {
    const id = `${track}-${c.id}`;
    const prev = existing.get(id);
    if (!args.has("fresh") && prev && prev.provider !== "mock" && Date.now() - Date.parse(prev.generatedAt) < 36 * 3600e3) {
      console.log(`  = reuse ${id}`);
      shorts.push(prev);
      continue;
    }
    console.log(`  + write ${id}: ${c.items[0].title.slice(0, 70)}`);
    shorts.push(await writeScript(track, c, mock));
  }

  // Narrate the highest-ranked stories first; the rest use the browser voice.
  let used = 0;
  for (const s of shorts) {
    if (noTts || s.audio || s.provider === "mock") continue;
    if (used >= ttsBudget) break;
    try {
      const r = await synthesize(s.segments.map((x) => x.text).join(" "));
      s.audio = { src: r.file, durationSec: Math.round(r.durationSec * 10) / 10, model: r.model, voice: r.voice };
      if (r.model !== "cache") used++;
      console.log(`  ♪ ${s.id}: ${r.durationSec.toFixed(1)}s via ${r.model}`);
    } catch (e) {
      console.warn(`  ! tts ${s.id}: ${(e as Error).message.slice(0, 200)}`);
      if (/exhausted/.test((e as Error).message)) break;
    }
  }

  const feed: ShortsFeed = { generatedAt: new Date().toISOString(), mode: mock ? "mock" : "live", shorts };
  writeFileSync(OUT, JSON.stringify(feed, null, 2) + "\n");

  // Prune narration files no longer referenced by the live or mock datasets.
  const mockFeed = path.join(process.cwd(), "data", "mock-shorts.json");
  const keep = new Set(shorts.map((s) => s.audio?.src).filter(Boolean));
  if (existsSync(mockFeed)) for (const s of (JSON.parse(readFileSync(mockFeed, "utf8")) as ShortsFeed).shorts) if (s.audio) keep.add(s.audio.src);
  const dir = path.join(process.cwd(), "public", "audio");
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.(mp3|wav)$/.test(f) && !keep.has(`/audio/${f}`)) rmSync(path.join(dir, f));

  console.log(`✓ wrote ${shorts.length} shorts (${shorts.filter((s) => s.audio).length} narrated) → data/shorts.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
