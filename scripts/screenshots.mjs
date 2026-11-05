// Captures README screenshots from a running app: `npm run build && npm start`, then `npm run screenshots`.
// Picks stories from data/shorts.json (or the mock dataset), so it always matches the current data.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "docs/screenshots";
const quick = process.argv.includes("--quick"); // 1x for quick visual checks
mkdirSync(OUT, { recursive: true });

const feed = JSON.parse(readFileSync(existsSync("data/shorts.json") ? "data/shorts.json" : "data/mock-shorts.json", "utf8"));
const shorts = feed.shorts.filter((s) => s.provider !== "mock");
const withVisual = (kind) => shorts.find((s) => s.audio && s.segments.some((g) => g.visual?.kind === kind));
const coverageShort = shorts.find((s) => s.coverageSummary?.differences && s.sources.length >= 3) ?? shorts.find((s) => s.coverageSummary);
const hindiShort = shorts.find((s) => s.i18n?.hi?.audio);
const numberShort = withVisual("number") ?? shorts[0];

const browser = await chromium.launch();
const mk = async (prefs) => {
  const ctx = await browser.newContext(quick ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { ...devices["iPhone 14 Pro"] });
  if (prefs) await ctx.addInitScript((p) => { localStorage.setItem("ns.prefs.v1", JSON.stringify(p.prefs)); localStorage.setItem("ns.tracks.v1", JSON.stringify(p.tracks)); }, prefs);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  return page;
};
const wait = (p, ms) => p.waitForTimeout(ms);
const play = async (p) => { await p.locator(".gesture-gate").click().catch(() => {}); };
const ALL = ["technology", "sports", "finance", "politics", "world", "india", "science"];

// 1. onboarding
let page = await mk();
await page.goto(BASE);
await wait(page, 1200);
for (const t of [/Technology/, /World/, /India/, /Science/]) await page.getByRole("button", { name: t }).click();
await page.evaluate(() => document.querySelector(".onb-shell")?.scrollTo(0, 0));
await wait(page, 600);
await page.screenshot({ path: `${OUT}/01-onboarding.png` });
await page.context().close();

// 2. a figure scene mid-count-up, with karaoke captions
page = await mk({ prefs: { muted: true, captions: true, onboarded: true, lang: "en" }, tracks: ALL });
await page.goto(`${BASE}/s/${encodeURIComponent(numberShort.id)}`);
await wait(page, 1000);
await play(page);
await wait(page, 7000);
await page.screenshot({ path: `${OUT}/02-feed.png` });

// 3. next beats: kinetic headline with words lit as they're spoken
await wait(page, 9000);
await page.screenshot({ path: `${OUT}/03-visual.png` });
await page.context().close();

// 4. how outlets covered it
if (coverageShort) {
  page = await mk({ prefs: { muted: true, captions: true, onboarded: true, lang: "en" }, tracks: ALL });
  await page.goto(`${BASE}/s/${encodeURIComponent(coverageShort.id)}`);
  await wait(page, 1000);
  await play(page);
  await wait(page, 2500);
  await page.locator(".outlets-chip").first().click({ force: true });
  await wait(page, 900);
  await page.screenshot({ path: `${OUT}/04-coverage.png` });
  await page.context().close();
}

// 5. Hindi (India track)
if (hindiShort) {
  page = await mk({ prefs: { muted: true, captions: true, onboarded: true, lang: "hi" }, tracks: ALL });
  await page.goto(`${BASE}/s/${encodeURIComponent(hindiShort.id)}`);
  await wait(page, 1000);
  await play(page);
  await wait(page, 6500);
  await page.screenshot({ path: `${OUT}/05-hindi.png` });
  await page.context().close();
}

// 6. catch-up playlist
page = await mk({ prefs: { muted: true, captions: true, onboarded: true, lang: "en" }, tracks: ALL });
await page.goto(`${BASE}/catch-up`);
await wait(page, 1200);
await page.screenshot({ path: `${OUT}/06-catchup.png` });
await play(page);
await wait(page, 6000);
await page.screenshot({ path: `${OUT}/07-catchup-playing.png` });
await browser.close();
console.log(`screenshots → ${OUT}`);
