// Three-size browser check for OMEGA pages (DESIGN.md §5, ADR-088).
// Mobile 390x844 @3x, Laptop 1440x900, Ultra-wide 2560x1080, each in light and dark.
// Fails on console errors, page errors or horizontal overflow; saves screenshots.
// Usage: npm i playwright-core@1.56.1 && node scripts/ui-three-sizes.mjs <url> [out-dir]
//        ALLOW_NET_ERRORS=1 node scripts/ui-three-sizes.mjs <url>   (sandbox without internet)
// In the cloud container Chromium is at /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const out = process.argv[3] || "ui-shots";
if (!url) { console.error("usage: node scripts/ui-three-sizes.mjs <url> [out-dir]"); process.exit(2); }
mkdirSync(out, { recursive: true });

const SIZES = [
  { tag: "mobile", width: 390, height: 844, mobile: true },
  { tag: "laptop", width: 1440, height: 900, mobile: false },
  { tag: "ultrawide", width: 2560, height: 1080, mobile: false },
];
// Requests to local services that are expected to be offline on a dev machine (n8n, Newton, Core API).
// ALLOW_NET_ERRORS=1 also ignores blocked outside feeds, for sandboxes without internet.
const EXPECTED_OFFLINE = process.env.ALLOW_NET_ERRORS === "1" ? /net::ERR_/ : /ERR_CONNECTION_REFUSED/;

const browser = await chromium.launch();
let failures = 0;
for (const s of SIZES) for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 3 : 1,
    isMobile: s.mobile, hasTouch: s.mobile, colorScheme: theme,
  });
  await ctx.addInitScript(t => { try { localStorage.setItem("omega-theme", t); localStorage.setItem("nabd-theme", t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error" && !EXPECTED_OFFLINE.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = `${out}/${s.tag}-${theme}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const ok = !errors.length && overflow <= 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${s.tag} ${theme} overflow=${overflow}px errors=${errors.length} -> ${file}`);
  for (const e of errors) console.log("   " + e);
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
