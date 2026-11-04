// Builds lib/trails.enc.json: the given GPX files, encrypted with the party passcode, so the
// app can show them without the trail locations being readable in the public repository.
//   PASSCODE='the party passcode' node --experimental-strip-types scripts/encrypt-trails.mjs file1.gpx [file2.gpx…]
// Never commit the GPX files or the passcode. Re-run with the new passcode if it changes.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { parseGpx, simplify } from "../lib/gpx.ts";

const pass = process.env.PASSCODE;
const files = process.argv.slice(2);
if (!pass || !files.length) { console.error("usage: PASSCODE=… node --experimental-strip-types scripts/encrypt-trails.mjs file.gpx…"); process.exit(1); }
const trails = [];
for (const f of files) {
  for (const t of parseGpx(readFileSync(f, "utf8"), basename(f).replace(/\.[^.]+$/, ""))) {
    let lines = t.lines;
    for (const tol of [1, 2, 4, 8]) { if (lines.reduce((s, l) => s + l.length, 0) <= 20000) break; lines = t.lines.map((l) => simplify(l, tol)); }
    const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    trails.push({ id: `builtin:${slug}`, name: t.name, color: t.color, lines, addedBy: "the party", at: 0 });
  }
}
const salt = randomBytes(16), iv = randomBytes(12);
const key = scryptSync(pass.trim().toLowerCase(), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const c = createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([c.update(JSON.stringify(trails), "utf8"), c.final()]);
const out = { v: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "trails.enc.json");
writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest}: ${trails.length} trail(s), ${trails.reduce((s, t) => s + t.lines.reduce((a, l) => a + l.length, 0), 0)} points, ${data.length} bytes encrypted`);
