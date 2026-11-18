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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // Rebuild when there is no build, or the data the static /render pages were generated from changed since.
  const built = existsSync(".next/BUILD_ID") ? statSync(".next/BUILD_ID").mtimeMs : 0;
  const stale = !built || ["data/shorts.json", "data/mock-shorts.json"].some((f) => existsSync(f) && statSync(f).mtimeMs > built);
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

// Chromium already rasterises one page on several threads; extra workers rarely help on small machines.
const workers = Math.max(1, Number(flag("workers", 1)));
const url = `${base}/render/${encodeURIComponent(short.id)}${lang === "en" ? "" : `?lang=${lang}`}`;
const browser = await chromium.launch();
const encode = (out, input = ["-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-"]) =>
  spawn("ffmpeg", ["-y", "-loglevel", "error", ...input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), out], { stdio: ["pipe", "inherit", "inherit"] });
const finished = (proc) => new Promise((resolve, reject) => { proc.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))); proc.on("error", reject); });

try {
  // Probe duration once.
  const probe = await (await browser.newContext({ viewport: { width: 540, height: 960 } })).newPage();
  await probe.goto(url);
  await probe.waitForFunction(() => window.__render, null, { timeout: 30000 });
  const duration = await probe.evaluate(() => window.__render.duration);
  await probe.context().close();
  const seconds = limit || duration + 0.8;
  const frames = Math.ceil(seconds * fps);
  const n = Math.min(workers, Math.max(1, Math.floor(frames / fps))); // at least 1 s per worker
  console.log(`Rendering ${short.id} [${lang}] — ${seconds.toFixed(1)}s, ${frames} frames @ ${fps} fps on ${n} worker${n > 1 ? "s" : ""}${audioFile ? " + narration" : " (no narration available: silent video)"}`);

  const tmp = path.join(tmpdir(), `ns-export-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const t0 = Date.now();
  let doneFrames = 0;
  let lastLog = 0;

  // Each worker renders a contiguous frame range in its own page (its own renderer process → its own CPU core).
  const parts = await Promise.all(
    Array.from({ length: n }, async (_, w) => {
      const from = Math.floor((w * frames) / n);
      const to = Math.floor(((w + 1) * frames) / n);
      const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.error(`page error (worker ${w}):`, e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.__render, null, { timeout: 30000 });
      // Warm up through the 2 s before this range so in-flight entrance animations are in the right state.
      for (let i = Math.max(0, from - 2 * fps); i < from; i++) await page.evaluate((t) => window.__render.setTime(t), i / fps);
      const cdp = await context.newCDPSession(page);
      const out = path.join(tmp, `part-${String(w).padStart(2, "0")}.mp4`);
      const ff = encode(out);
      const exited = finished(ff);
      for (let i = from; i < to; i++) {
        await page.evaluate((t) => window.__render.setTime(t), i / fps);
        // Raw DevTools capture at 2× (1080×1920); faster than page.screenshot(), which re-stabilises the page each call.
        const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, width: 540, height: 960, scale: 2 } });
        if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
        doneFrames++;
        if (Date.now() - lastLog > 10000) {
          lastLog = Date.now();
          console.log(`  ${Math.round((doneFrames / frames) * 100)}%  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        }
      }
      ff.stdin.end();
      await exited;
      await context.close();
      return out;
    }),
  );

  // Join the parts (stream copy) and add the narration.
  const list = path.join(tmp, "parts.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n") + "\n");
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    ...(audioFile ? ["-i", audioFile, "-c:a", "aac", "-b:a", "128k", "-af", "apad"] : []),
    "-c:v", "copy", "-t", String(seconds), "-movflags", "+faststart", outFile,
  ]);
  rmSync(tmp, { recursive: true, force: true });
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
