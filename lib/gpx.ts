// Reading trails out of GPX files (from Topo Maps, Gaia, onX, Garmin…). Pure string parsing, so it
// works the same in the browser and in tests. Tracks (<trk>/<trkseg>/<trkpt>) and routes
// (<rte>/<rtept>) are both read; each becomes one trail with one or more lines.

export type TrailLine = [number, number][]; // [lat, lon]
export type ParsedTrail = { name: string; color: string; lines: TrailLine[] };

const COLORS: Record<string, string> = {
  yellow: "#ffd43b", red: "#e03131", blue: "#1c7ed6", green: "#2f9e44", orange: "#f76707",
  purple: "#7048e8", pink: "#e64980", white: "#ffffff", black: "#212529", brown: "#8b5a2b",
};
export const DEFAULT_TRAIL_COLOR = COLORS.yellow;

function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function colorOf(body: string): string {
  // <cmt>yellow</cmt> (Topo Maps), <color>…</color>, or a Garmin DisplayColor extension
  const raw = (body.match(/<(?:cmt|color|gpxx:DisplayColor|DisplayColor)>([^<]*)</i) || [])[1];
  if (!raw) return DEFAULT_TRAIL_COLOR;
  const v = decode(raw).toLowerCase().replace(/^dark/, "");
  if (COLORS[v]) return COLORS[v];
  if (/^#?[0-9a-f]{6}$/i.test(v)) return v.startsWith("#") ? v : `#${v}`;
  return DEFAULT_TRAIL_COLOR;
}

function points(seg: string, tag: string): TrailLine {
  const out: TrailLine = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "g");
  for (const m of seg.matchAll(re)) {
    const lat = Number((m[1].match(/lat\s*=\s*["']([-0-9.eE+]+)["']/) || [])[1]);
    const lon = Number((m[1].match(/lon\s*=\s*["']([-0-9.eE+]+)["']/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]);
    }
  }
  return out;
}

/** All trails in a GPX file. `fallbackName` (e.g. the file name) is used when a track has no name. */
export function parseGpx(xml: string, fallbackName = "Trail"): ParsedTrail[] {
  const trails: ParsedTrail[] = [];
  for (const [, kind, body] of xml.matchAll(/<(trk|rte)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const before = body.split(/<(?:trkseg|rtept)\b/)[0];
    const name = decode((before.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || "") || fallbackName;
    const segs = kind === "trk" ? [...body.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)].map((m) => m[1]) : [body];
    const lines = segs.map((s) => points(s, kind === "trk" ? "trkpt" : "rtept")).filter((l) => l.length > 1);
    if (lines.length) trails.push({ name: name.slice(0, 80), color: colorOf(before), lines });
  }
  return trails;
}

/** Douglas–Peucker simplification in metres (keeps the shape, drops points that add nothing). */
export function simplify(line: TrailLine, toleranceM: number): TrailLine {
  if (line.length < 3) return line;
  const lat0 = (line[0][0] * Math.PI) / 180;
  const xy = line.map(([la, lo]) => [lo * 111320 * Math.cos(lat0), la * 110540]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let best = -1, bestD = toleranceM;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / L2));
      const d = Math.hypot(xy[i][0] - ax - dx * t, xy[i][1] - ay - dy * t);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/** Length of a trail in metres. */
export function trailLength(lines: TrailLine[]): number {
  let m = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const [a, b] = [l[i - 1], l[i]];
    const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
    m += Math.hypot((b[1] - a[1]) * 111320 * k, (b[0] - a[0]) * 110540);
  }
  return m;
}
