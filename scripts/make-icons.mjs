// Renders the app icon SVG to PNGs with the pre-installed Playwright Chromium.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // pre-installed globally (NODE_PATH) or devDependency
import { mkdirSync, writeFileSync } from "node:fs";

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BFF"/><stop offset=".55" stop-color="#B44DFF"/><stop offset="1" stop-color="#FF4D2E"/></linearGradient>
    <radialGradient id="h" cx=".75" cy=".2" r=".6"><stop offset="0" stop-color="#00E0FF" stop-opacity=".9"/><stop offset="1" stop-color="#00E0FF" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#07070B"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 0.9}) translate(-256 -256)">
    <rect x="136" y="56" width="240" height="400" rx="56" fill="url(#g)"/>
    <rect x="136" y="56" width="240" height="400" rx="56" fill="url(#h)"/>
    <rect x="172" y="96" width="76" height="10" rx="5" fill="#F5F2EA"/><rect x="256" y="96" width="84" height="10" rx="5" fill="#F5F2EA" opacity=".35"/>
    <path d="M222 196v120l100-60z" fill="#F5F2EA"/>
    <rect x="172" y="372" width="168" height="18" rx="9" fill="#F5F2EA"/><rect x="172" y="402" width="110" height="18" rx="9" fill="#00E0FF"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", svg(false));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [["icon-192", 192, false], ["icon-512", 512, false], ["icon-maskable-512", 512, true], ["apple-touch-icon", 180, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(pad).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await browser.close();
console.log("icons written");
