#!/usr/bin/env node
/**
 * Export a short as a vertical 1080×1920 MP4 (H.264 + AAC) for YouTube Shorts / Instagram Reels / TikTok.
 *
 *   npm run export:video -- --list
 *   npm run export:video -- technology-17t5szl
 *   npm run export:video -- india-xobzuy --lang=hi --fps=30 --out=exports
 *
 * How it works: the app has a chrome-less /render/<id> view where every pixel is a function of a time value. This script
 * opens it in headless Chromium, steps the clock frame by frame (CSS animations are seeked, not played), screenshots each
 * frame and pipes the JPEGs into ffmpeg together with the narration. Same visuals as the app, no screen recording.
 *
 * Needs: ffmpeg, Playwright with Chromium (preinstalled in many sandboxes; otherwise `npm i --no-save playwright &&
 * npx playwright install chromium`), and a built app (`npm run build`) — the script builds/starts it when missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const has = (name) => args.includes(`--${name}`);
const id = args.find((a) => !a.startsWith("--"));

const fps = Number(flag("fps", 30));
const lang = flag("lang", "en");
const outDir = flag("out", "exports");
const limit = Number(flag("limit", 0)); // render only the first N seconds (for quick tests)
const port = Number(flag("port", 3123));
let base = flag("base", "");

function loadShorts() {
  for (const f of ["data/shorts.json", "data/mock-shorts.json"]) {
    if (existsSync(f)) {
      const feed = JSON.parse(readFileSync(f, "utf8"));
      if (feed.shorts?.length) return feed.shorts;
    }
  }
  throw new Error("No data/shorts.json or data/mock-shorts.json found.");
}

const shorts = loadShorts();
if (has("list") || !id) {
  for (const s of shorts) console.log(`${s.id.padEnd(28)} ${s.track.padEnd(10)} ${s.audio ? "narrated" : "no audio"}${s.i18n?.hi ? " +hi" : ""}  ${s.title}`);
  process.exit(id || has("list") ? 0 : 1);
}
const short = shorts.find((s) => s.id === id) ?? shorts.find((s) => s.id.startsWith(id));
if (!short) throw new Error(`Short "${id}" not found. Run with --list to see ids.`);
const t = lang === "hi" ? short.i18n?.hi : short;
if (!t) throw new Error(`"${short.id}" has no ${lang} version.`);
const audio = t.audio;

function run(cmd, a, opts = {}) {
  const r = spawnSync(cmd, a, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed`);
}

async function resolveAudio() {
  if (!audio) return null;
  if (audio.src.startsWith("/")) return path.join("public", audio.src);
  const res = await fetch(audio.src);
  if (!res.ok) throw new Error(`Could not download narration (${res.status})`);
  const f = path.join(tmpdir(), `ns-audio-${Date.now()}${path.extname(new URL(audio.src).pathname) || ".mp3"}`);
  writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  return f;
}

let server = null;
async function ensureServer() {
  if (base) return;
  base = `http://localhost:${port}`;
  const stale = !existsSync(".next/BUILD_ID") || (existsSync("data/shorts.json") && statSync("data/shorts.json").mtimeMs > statSync(".next/BUILD_ID").mtimeMs);
  if (stale) {
    console.log("Building the app (data changed or no build yet)…");
    run("npx", ["next", "build"]);
  }
  server = spawn("npx", ["next", "start", "-p", String(port)], { stdio: "ignore", detached: false });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("App server did not start");
}

const { chromium } = require("playwright");
const audioFile = await resolveAudio();
await ensureServer();

mkdirSync(outDir, { recursive: true });
const name = `${short.id}${lang === "en" ? "" : `-${lang}`}`;
const outFile = path.join(outDir, `${name}.mp4`);

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })).newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${base}/render/${encodeURIComponent(short.id)}${lang === "en" ? "" : `?lang=${lang}`}`);
  await page.waitForFunction(() => window.__render, null, { timeout: 30000 });
  const duration = await page.evaluate(() => window.__render.duration);
  const seconds = (limit || duration + 0.8);
  const frames = Math.ceil(seconds * fps);
  console.log(`Rendering ${short.id} [${lang}] — ${seconds.toFixed(1)}s, ${frames} frames @ ${fps} fps${audioFile ? " + narration" : " (no narration available: silent video)"}`);

  const ff = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      ...(audioFile ? ["-i", audioFile] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps),
      ...(audioFile ? ["-c:a", "aac", "-b:a", "128k", "-af", "apad", "-t", String(seconds)] : ["-t", String(seconds)]),
      "-movflags", "+faststart", outFile,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((resolve, reject) => {
    ff.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
    ff.on("error", reject);
  });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((time) => window.__render.setTime(time), i / fps);
    const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % (fps * 5) === 0 && i) console.log(`  ${Math.round((i / frames) * 100)}%  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await done;
  console.log(`✓ ${outFile}  (${(statSync(outFile).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} finally {
  await browser.close();
  server?.kill();
}

// Ready-to-paste post text with source credits.
const tags = { technology: "#tech #ai", sports: "#sports", finance: "#finance #markets", politics: "#politics", world: "#worldnews", india: "#india #news", science: "#science" }[short.track] ?? "#news";
const caption = [
  t.title,
  "",
  t.hook,
  "",
  t.whyItMatters,
  "",
  `Sources: ${short.sources.map((s) => `${s.outlet} (${s.url})`).join(" · ")}`,
  "AI-written script and AI voice. Check the sources.",
  "",
  `${tags} #news #shorts #newsshorts`,
].join("\n");
writeFileSync(path.join(outDir, `${name}.txt`), caption + "\n");
console.log(`✓ ${path.join(outDir, `${name}.txt`)} (post caption)`);
