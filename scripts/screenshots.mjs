// Captures README screenshots from a running app: `npm run build && npm start`, then `npm run screenshots`.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "docs/screenshots";
const quick = process.argv.includes("--quick"); // 1x for quick visual checks
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext(quick ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { ...devices["iPhone 14 Pro"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await wait(1200);
await page.getByRole("button", { name: /Technology/ }).click();
await page.getByRole("button", { name: /World/ }).click();
await page.getByRole("button", { name: /Finance/ }).click();
await page.getByRole("button", { name: /Science/ }).click();
await wait(400);
await shot("01-onboarding");
await page.getByRole("button", { name: "Start watching" }).click();
await wait(400);
await page.locator(".gesture-gate").click().catch(() => {});
await wait(5200);
await shot("02-feed");
await page.locator(".slot").nth(1).scrollIntoViewIfNeeded();
await wait(9000);
await shot("03-visual");
await page.getByRole("button", { name: "Sources and coverage" }).first().click({ force: true }).catch(() => {});
await wait(700);
const visibleSheet = page.locator(".sheet").first();
if (await visibleSheet.count()) await shot("04-sources");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/catch-up`);
await wait(1200);
await shot("05-catchup");
await page.locator(".gesture-gate").click().catch(() => {});
await wait(14000);
await shot("06-catchup-playing");
await browser.close();
console.log(`screenshots → ${OUT}`);
