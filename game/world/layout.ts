// The hunting spot: an old field in the bush, seen from a ladder stand on its south edge.
// Coordinates: metres, x = east, z = south (so the view north is toward -z), y = up.
// Everything here is plain functions of (x, z) so the terrain, the vegetation and the deer
// all agree about where the field, the brush and the cover are.
import { clamp, fbm, makeNoise2D, smoothstep } from "./noise";

export const STAND = { x: 0, z: 0, eye: 4.2 }; // eye height above the ground at the stand
export const VIEW_YAW_LIMIT = (48 * Math.PI) / 180; // how far left/right the rifle can swing

const n1 = makeNoise2D(11);
const n2 = makeNoise2D(23);
const n3 = makeNoise2D(37);
const n4 = makeNoise2D(53);

// Field outline (clockwise from the stand's left), before noise roughens it.
const FIELD: [number, number][] = [
  [-45, -14], [-120, -40], [-255, -95], [-330, -205], [-415, -335], [-470, -480], [-445, -640],
  [-515, -765], [-430, -905], [-255, -985], [-60, -1040], [150, -1005], [320, -935], [455, -820],
  [425, -660], [505, -520], [405, -385], [300, -250], [232, -122], [120, -40], [45, -12],
];

/** Tree islands inside the field: [x, z, radius] */
export const ISLANDS: [number, number, number][] = [
  [-175, -335, 34], [235, -565, 48], [72, -142, 11], [-70, -705, 24], [330, -330, 20],
];

/** Hedgerow along an old rail fence: polyline [x, z], with a gap the deer use. */
export const HEDGE: [number, number][][] = [
  [[-470, -478], [-300, -470], [-130, -488]],
  [[-55, -492], [40, -486], [140, -478]],
];

/** A shallow swale with alders that crosses the near field. */
export const SWALE: [number, number][] = [[-330, -215], [-150, -262], [0, -252], [150, -270], [300, -250]];

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

export function polylineDist(x: number, z: number, line: [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}

/** Signed distance to the field outline (negative inside the field). */
function fieldSDF(x: number, z: number): number {
  let d = Infinity, inside = false;
  for (let i = 0, j = FIELD.length - 1; i < FIELD.length; j = i++) {
    const [xi, zi] = FIELD[i], [xj, zj] = FIELD[j];
    d = Math.min(d, segDist(x, z, xi, zi, xj, zj));
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

/** Distance (m) inside the field edge: positive in the open, negative in the bush. Roughened by noise. */
export function edgeDistance(x: number, z: number): number {
  let d = -fieldSDF(x, z) + 14 * fbm(n1, x / 90, z / 90, 3) + 4 * n2(x / 18, z / 18);
  const wob = 1 + 0.25 * n3(x / 15, z / 15);
  for (const [ix, iz, r] of ISLANDS) d = Math.min(d, Math.hypot(x - ix, z - iz) - r * wob);
  return d;
}

/** 1 = open field, 0 = forest. */
export function openness(x: number, z: number): number {
  return smoothstep(-4, 6, edgeDistance(x, z));
}

function hedgeFrom(x: number, z: number, wob: number): number {
  let d = Infinity;
  for (const h of HEDGE) d = Math.min(d, polylineDist(x, z, h));
  return 1 - smoothstep(3, 9 + 4 * wob, d);
}
/** 1 near the hedgerow line. */
export function hedgeness(x: number, z: number): number {
  return hedgeFrom(x, z, n4(x / 30, z / 30));
}

function swaleFrom(x: number, z: number, wob: number): number {
  return 1 - smoothstep(4, 14, polylineDist(x, z, SWALE) + 5 * wob);
}
/** 1 in the alder swale. */
export function swaleness(x: number, z: number): number {
  return swaleFrom(x, z, n4(x / 25, z / 25));
}

/** Tall old-field grass (near) vs the shorter meadow beyond the swale. 1 = tall grass. */
export function tallGrass(x: number, z: number): number {
  return 1 - smoothstep(-300, -380, z + 40 * n3(x / 120, z / 120));
}

/** How tall the grass is in the far meadow relative to the old field (it was hayed last year). */
export const MEADOW_HEIGHT = 0.65;

export type Ground = { h: number; edge: number; open: number; tall: number; hedge: number; swale: number };

/** Everything about one spot of ground, computed once (the terrain builder calls this ~150k times). */
export function sampleGround(x: number, z: number, out: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 }): Ground {
  const r = Math.hypot(x, z);
  const near = r < 1700;
  const edge = near ? edgeDistance(x, z) : -200;
  const open = smoothstep(-4, 6, edge);
  const w4 = n4(x / 25, z / 25);
  const swale = near ? swaleFrom(x, z, w4) : 0;
  out.edge = edge;
  out.open = open;
  out.swale = swale;
  out.hedge = near ? hedgeFrom(x, z, w4) : 0;
  out.tall = near ? tallGrass(x, z) : 0;
  out.h = heightFrom(x, z, r, open, swale, w4);
  return out;
}

function heightFrom(x: number, z: number, r: number, open: number, swale: number, w4: number): number {
  // Field slopes down to the swale, then rises away from the stand so far ground stays visible.
  const zf = -z;
  let base = zf < 260 ? -6 * smoothstep(0, 260, zf) : -6 + 34 * smoothstep(260, 1050, zf);
  base += 18 * smoothstep(1000, 1500, zf);
  // Rolling ground everywhere, rougher in the bush (granite, ridges).
  const roll = 7 * fbm(n1, x / 380, z / 380, 4) + 1.4 * fbm(n2, x / 70, z / 70, 3);
  const rough = open < 1 ? (1 - open) * smoothstep(20, 120, r) * (4 * Math.abs(fbm(n3, x / 120, z / 120, 4)) + 1.0 * w4) : 0;
  let hills = 0;
  if (r > 1300) {
    // Distant hills: a ring of Shield hills, highest behind the field.
    const far = smoothstep(1300, 3500, r);
    const ang = Math.atan2(x, -z);
    // rounded, forested Shield hills (no sharp ridges)
    const big = 0.5 + 0.5 * fbm(n2, x / 2600, z / 2600, 3);
    const mid = fbm(n4, x / 900, z / 900, 3);
    hills = far * (35 + 95 * big * big + 22 * mid) * (0.8 + 0.3 * Math.cos(ang));
  }
  // Flatten the stand's own spot a little.
  const flat = smoothstep(0, 25, r);
  return (base + roll + rough - 2.2 * swale) * flat + hills;
}

/** Ground height (m) above the stand's ground level. */
export function terrainHeight(x: number, z: number): number {
  return sampleGround(x, z).h;
}

// ---------- fast lookups ----------
// Terrain, trees, rocks and grass ask about the ground hundreds of thousands of times.
// sampleGround is computed once on a 4 m grid over the field and its edges, then read back
// with bilinear interpolation (the shapes it describes are all much bigger than 4 m).
const GC = { x0: -1150, z0: -1250, x1: 1150, z1: 40, step: 4 };
let gcData: Float32Array | null = null;
let gcW = 0, gcH = 0;
const FIELDS = 6; // h, edge, tall, hedge, swale, (pad)

export function buildGroundCache() {
  if (gcData) return;
  gcW = Math.round((GC.x1 - GC.x0) / GC.step) + 1;
  gcH = Math.round((GC.z1 - GC.z0) / GC.step) + 1;
  gcData = new Float32Array(gcW * gcH * FIELDS);
  const g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };
  for (let j = 0; j < gcH; j++) for (let i = 0; i < gcW; i++) {
    sampleGround(GC.x0 + i * GC.step, GC.z0 + j * GC.step, g);
    const k = (j * gcW + i) * FIELDS;
    gcData[k] = g.h; gcData[k + 1] = g.edge; gcData[k + 2] = g.tall; gcData[k + 3] = g.hedge; gcData[k + 4] = g.swale;
  }
}

/** Same as sampleGround, from the cache when the point is inside it. */
export function sampleGroundFast(x: number, z: number, out: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 }): Ground {
  if (!gcData) return sampleGround(x, z, out);
  const fx = (x - GC.x0) / GC.step, fz = (z - GC.z0) / GC.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= gcW - 1 || j >= gcH - 1) return sampleGround(x, z, out);
  const u = fx - i, v = fz - j;
  const k00 = (j * gcW + i) * FIELDS, k10 = k00 + FIELDS, k01 = k00 + gcW * FIELDS, k11 = k01 + FIELDS;
  const d = gcData;
  const lerp4 = (o: number) => (d[k00 + o] * (1 - u) + d[k10 + o] * u) * (1 - v) + (d[k01 + o] * (1 - u) + d[k11 + o] * u) * v;
  out.h = lerp4(0);
  out.edge = lerp4(1);
  out.open = smoothstep(-4, 6, out.edge);
  out.tall = lerp4(2);
  out.hedge = lerp4(3);
  out.swale = lerp4(4);
  return out;
}
