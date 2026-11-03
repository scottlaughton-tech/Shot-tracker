// Saves the code-drawn foliage atlas to public/game/tex/atlas.webp so the game can load it
// instead of drawing it on every start (drawing takes seconds on a phone).
// Run after changing game/world/foliageTextures.ts:
//   npm run dev   (in another terminal, port 3000; or set BASE_URL)
//   npm run bake-atlas
// Needs Playwright (npx playwright install chromium) and Python with Pillow for the WebP step.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const base = process.env.BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto(`${base}/game/debug?show=atlasraw`, { timeout: 180000 });
  await page.waitForFunction(() => window.__atlas, null, { timeout: 180000 });
  const url = await page.evaluate(() => window.__atlas);
  await browser.close();
  const png = path.join(__dirname, "..", "public", "game", "tex", "atlas.png");
  fs.writeFileSync(png, Buffer.from(url.split(",")[1], "base64"));
  const webp = png.replace(/\.png$/, ".webp");
  execFileSync("python3", ["-c", `from PIL import Image; Image.open(${JSON.stringify(png)}).save(${JSON.stringify(webp)}, "WEBP", quality=90, alpha_quality=100, method=6)`]);
  fs.unlinkSync(png);
  console.log("wrote", webp, Math.round(fs.statSync(webp).size / 1024), "KB");
})();
