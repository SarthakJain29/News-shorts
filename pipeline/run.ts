/**
 * News Shorts pipeline:
 *   RSS → dedupe → local-embedding clustering → original scripts (Groq) → Hindi for India → Kokoro narration
 *   → word-timing alignment → data/shorts.json (+ audio in public/audio or an S3-compatible bucket)
 *
 *   npm run pipeline                      # everything
 *   npm run pipeline -- --no-tts          # scripts only
 *   npm run pipeline -- --tracks=tech,india --max=2
 *   npm run pipeline -- --fresh           # ignore cached scripts
 *   npm run pipeline:mock                 # live feeds, offline writer, no LLM calls (narration still runs locally)
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TRACK_IDS, type Lang, type NarrationAudio, type Short, type ShortsFeed, type TrackId } from "../src/lib/types";
import { cluster, dedupe, DEFAULT_EMBED_THRESHOLD, pickStories, type Cluster } from "./cluster";
import { embedItems } from "./embed";
import { FEEDS } from "./feeds";
import { completeWithFallback, providerChain } from "./llm";
import { narrate } from "./narrate";
import { fetchFeed, type RawItem } from "./rss";
import { buildPrompt, draftToShort, extractJson, mockShort } from "./script";
import { stringifyFeed } from "./serialize";
import { createStore } from "./storage";
import { translateToHindi } from "./translate";
import { ttsChain } from "./tts";

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
const log = (m: string) => console.log(m);

async function ingest(track: TrackId): Promise<RawItem[]> {
  const results = await Promise.allSettled(FEEDS[track].map((f) => fetchFeed(f.url, f.outlet)));
  const items: RawItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value.slice(0, 25).map((it) => ({ ...it, tracks: [track] })));
    else console.warn(`  ! ${track}/${FEEDS[track][i].outlet}: ${(r.reason as Error).message}`);
  });
  const fresh = items.filter((it) => Date.now() - Date.parse(it.publishedAt) < 3 * 86400e3);
  return fresh.length >= 6 ? fresh : items;
}

function readFeed(file: string): ShortsFeed | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ShortsFeed;
  } catch {
    return null;
  }
}

async function writeScript(track: TrackId, c: Cluster, mock: boolean): Promise<Short> {
  const chain = mock ? [] : providerChain();
  if (chain.length === 0) return mockShort(track, c);
  const prompt = buildPrompt(track, c);
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await completeWithFallback(chain, { ...prompt, user: prompt.user + feedback, json: true, temperature: 0.5 + attempt * 0.1 }, console.warn);
      return draftToShort(extractJson(res.text), track, c, res.provider as Short["provider"]);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      console.warn(`  ! script attempt ${attempt + 1}: ${msg}`);
      feedback = `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${msg}. Fix this. Rephrase everything in fresh words.`;
      await sleep(1000);
    }
  }
  console.warn("  ! falling back to offline writer");
  return mockShort(track, c);
}

interface Job {
  short: Short;
  lang: Lang;
  /** 0 = lead story of its track. Lead stories are narrated first (they head every "catch me up" playlist). */
  rank: number;
}

async function main() {
  loadDotEnv();
  const env = process.env;
  const mock = args.has("mock");
  const noTts = args.has("no-tts") || (env.TTS_PROVIDERS ?? "kokoro") === "none";
  const maxPerTrack = Number(args.get("max") ?? env.PIPELINE_MAX_STORIES_PER_TRACK ?? 4);
  const budgetMin = Number(env.NARRATE_BUDGET_MIN ?? 0);
  const hindiTracks = (env.HINDI_TRACKS ?? "india").split(",").map((s) => s.trim()).filter(Boolean) as TrackId[];
  const wanted = args.get("tracks")?.split(",") ?? [...TRACK_IDS];
  const tracks = TRACK_IDS.filter((t) => wanted.some((w) => t.startsWith(w)));
  const llm = mock ? [] : providerChain();
  const store = createStore(env);
  const chain = noTts ? [] : ttsChain(env);

  const existingFeed = readFeed(OUT);
  const existing = new Map((existingFeed?.shorts ?? []).map((s) => [s.id, s]));
  const known = new Map<string, NarrationAudio>();
  for (const f of [OUT, path.join(process.cwd(), "data", "mock-shorts.json")])
    for (const s of readFeed(f)?.shorts ?? []) for (const a of [s.audio, ...Object.values(s.i18n ?? {}).map((t) => t?.audio)]) if (a?.key) known.set(a.key, a);

  console.log(
    `News Shorts pipeline — tracks: ${tracks.join(", ")}\n  writer: ${llm.length ? llm.map((p) => `${p.name}:${p.model}`).join(" → ") : "offline"} | narration: ${noTts ? "off" : chain.map((p) => p.name).join(" → ") || "none"} | audio store: ${store.kind}`,
  );

  // 1. Ingest every track, then cluster the whole pool so one story = one cluster across desks and outlets.
  const perTrack = await Promise.all(tracks.map(async (t) => ingest(t)));
  const items = dedupe(perTrack.flat());
  let clusters: Cluster[];
  let method = "lexical";
  try {
    if (env.EMBED === "0") throw new Error("EMBED=0");
    const vectors = await embedItems(items, { env, log });
    clusters = cluster(items, Date.now(), vectors, Number(env.EMBED_THRESHOLD ?? DEFAULT_EMBED_THRESHOLD));
    method = "embeddings";
  } catch (e) {
    console.warn(`  ! embeddings unavailable (${(e as Error).message.slice(0, 120)}) — using lexical clustering`);
    clusters = cluster(items);
  }
  const multi = clusters.filter((c) => c.outlets.length > 1).length;
  console.log(`• ${items.length} articles → ${clusters.length} stories (${multi} covered by 2+ outlets) via ${method}`);

  const picked = pickStories(clusters, tracks, maxPerTrack);
  if (picked.length === 0) {
    console.error("No stories ingested (network down?). Keeping existing data/shorts.json.");
    return;
  }

  // 2. Scripts (reuse recent ones so audio caches stay valid), then Hindi renditions.
  const shorts: Short[] = [];
  const rankOf = new Map<string, number>();
  const seenTrack = new Map<TrackId, number>();
  for (const { track, c } of picked) {
    const id = `${track}-${c.id}`;
    rankOf.set(id, seenTrack.get(track) ?? 0);
    seenTrack.set(track, (seenTrack.get(track) ?? 0) + 1);
    const prev = existing.get(id);
    const fresh = prev && Date.now() - Date.parse(prev.generatedAt) < 72 * 3600e3;
    if (!args.has("fresh") && prev && prev.provider !== "mock" && fresh && (prev.audio || prev.sources.length >= c.outlets.length)) {
      console.log(`  = reuse ${id}`);
      shorts.push(prev);
      continue;
    }
    console.log(`  + write ${id} [${c.outlets.length} outlets]: ${c.items[0].title.slice(0, 70)}`);
    shorts.push(await writeScript(track, c, mock));
  }

  if (llm.length && hindiTracks.length) {
    for (const s of shorts) {
      if (!hindiTracks.includes(s.track) || s.provider === "mock" || s.i18n?.hi) continue;
      try {
        console.log(`  + hindi ${s.id}`);
        s.i18n = { ...s.i18n, hi: await translateToHindi(s, llm, console.warn) };
      } catch (e) {
        console.warn(`  ! hindi ${s.id}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  }

  // Moving to object storage: upload narration that still lives in public/audio and point the data at the bucket.
  if (store.kind === "s3") {
    for (const s of shorts)
      for (const a of [s.audio, s.i18n?.hi?.audio]) {
        const local = a?.src.startsWith("/audio/") ? path.join(process.cwd(), "public", a.src) : null;
        if (a && local && existsSync(local)) {
          try {
            a.src = await store.publish(local);
            console.log(`  ↑ uploaded ${path.basename(local)}`);
          } catch (e) {
            console.warn(`  ! upload ${path.basename(local)}: ${(e as Error).message.slice(0, 140)}`);
          }
        }
      }
  }

  // 3. Narration: every short, lead stories first, cached by content hash, optional wall-clock budget.
  if (chain.length) {
    const jobs: Job[] = [];
    for (const s of shorts) {
      if (s.provider === "mock" && !mock) continue; // offline-writer placeholder: rewritten next run, not worth narrating
      const rank = rankOf.get(s.id) ?? 99;
      if (!s.audio || args.has("renarrate")) jobs.push({ short: s, lang: "en", rank });
      if (s.i18n?.hi && (!s.i18n.hi.audio || args.has("renarrate"))) jobs.push({ short: s, lang: "hi", rank });
    }
    jobs.sort((a, b) => a.rank * 2 + (a.lang === "hi" ? 1 : 0) - (b.rank * 2 + (b.lang === "hi" ? 1 : 0)));
    const t0 = Date.now();
    let done = 0;
    for (const job of jobs) {
      if (budgetMin && (Date.now() - t0) / 60000 > budgetMin) {
        console.log(`  … narration time budget (${budgetMin} min) reached; ${jobs.length - done} left for the next run`);
        break;
      }
      const src = job.lang === "hi" ? job.short.i18n!.hi! : job.short;
      try {
        const t1 = Date.now();
        const audio = await narrate(src.segments.map((g) => g.text), job.lang, { env, store, chain, known, log });
        src.audio = audio;
        if (audio.key) known.set(audio.key, audio);
        done++;
        console.log(`  ♪ ${job.short.id} [${job.lang}] ${audio.durationSec}s via ${audio.model}/${audio.voice} (${((Date.now() - t1) / 1000).toFixed(0)}s)`);
      } catch (e) {
        console.warn(`  ! narrate ${job.short.id} [${job.lang}]: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }

  // A partial run (--tracks) keeps the other tracks' shorts from the previous feed.
  const untouched = [...existing.values()].filter((s) => !tracks.includes(s.track));
  if (untouched.length) console.log(`  = kept ${untouched.length} shorts from tracks not in this run`);
  const feed: ShortsFeed = { generatedAt: new Date().toISOString(), mode: mock ? "mock" : "live", shorts: [...shorts, ...untouched] };
  writeFileSync(OUT, stringifyFeed(feed));

  // Prune local narration files nobody references any more (object storage is left alone).
  if (store.kind === "local" && existsSync(store.dir)) {
    const keep = new Set<string>();
    const mockFeed = readFeed(path.join(process.cwd(), "data", "mock-shorts.json"));
    for (const f of [feed, mockFeed]) for (const s of f?.shorts ?? []) for (const a of [s.audio, ...Object.values(s.i18n ?? {}).map((t) => t?.audio)]) if (a) keep.add(path.basename(a.src));
    for (const f of readdirSync(store.dir)) if (/\.(mp3|wav)$/.test(f) && !keep.has(f)) rmSync(path.join(store.dir, f));
  }

  const all = feed.shorts;
  console.log(`✓ wrote ${all.length} shorts (${all.filter((s) => s.audio).length} narrated, ${all.filter((s) => s.i18n?.hi).length} with Hindi, ${all.filter((s) => s.audio?.wordTimes).length} with exact word timings) → data/shorts.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
