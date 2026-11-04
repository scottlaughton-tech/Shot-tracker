// Where bucks come from and where they go: points just inside the cover along the field
// edges, hedgerow and islands, and routes that cross the open ground between them.
import { edgeDistance, sampleGround } from "../world/layout";

export type P2 = { x: number; z: number };
export type CoverPoint = P2 & { range: number; azim: number; outX: number; outZ: number };

// Keep bucks well inside the open view: it shows ±35°, and the buttons cover part of the right side.
export const VIEW = (30 * Math.PI) / 180;

let cache: CoverPoint[] | null = null;

/** Points on the edge of cover, with the direction pointing out into the open. */
export function coverPoints(): CoverPoint[] {
  if (cache) return cache;
  const pts: CoverPoint[] = [];
  // a 9 m grid, finer (4.5 m) near the stand so the small brush clumps there get enough points
  const NEAR = 260;
  for (const [step, rMin, rMax] of [[9, NEAR, 980], [4.5, 60, NEAR]]) for (let z = -1000; z < -50; z += step) {
    for (let x = -700; x <= 700; x += step) {
      const r = Math.hypot(x, z), azim = Math.atan2(x, -z);
      if (Math.abs(azim) > VIEW || r < rMin || r >= rMax) continue;
      const e = edgeDistance(x, z);
      if (e < -3 || e > 3) continue;
      // direction of increasing openness
      const gx = edgeDistance(x + 3, z) - edgeDistance(x - 3, z), gz = edgeDistance(x, z + 3) - edgeDistance(x, z - 3);
      const gl = Math.hypot(gx, gz) || 1;
      pts.push({ x, z, range: r, azim, outX: gx / gl, outZ: gz / gl });
    }
  }
  cache = pts;
  return pts;
}

/** Out in the open where he can be seen: clear of the bush edge, the hedgerow and the alder swale. */
function open(x: number, z: number) {
  if (edgeDistance(x, z) < 10) return false;
  const g = sampleGround(x, z);
  return g.hedge < 0.2 && g.swale < 0.25;
}
/** The whole walk from a to b stays in the open (checked at a few points along it). */
function clearPath(a: P2, b: P2) {
  for (const t of [0.25, 0.5, 0.75, 1]) if (!open(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  return true;
}

export type Route = { points: P2[]; /** index of the spot where he stops broadside */ poseAt: number };

/**
 * A route for one buck: start hidden in the cover, walk out, come to a spot inside the given
 * range band (where an easy buck stops broadside), cross the field within the band, and leave
 * into cover somewhere else. The cover may be outside the band; he walks (or trots) to it.
 */
export function makeRoute(rnd: () => number, range: [number, number], maxAzim = VIEW): Route | null {
  maxAzim = Math.min(maxAzim, VIEW);
  const pts = coverPoints();
  const [lo, hi] = range;
  // cover right at the band, so he steps out close to where he'll stand (wider only if there's none)
  let near: CoverPoint[] = [];
  for (const [below, above] of [[25, 40], [60, 120], [60, 220]]) {
    near = pts.filter((p) => p.range >= lo - below && p.range <= hi + above && Math.abs(p.azim) <= maxAzim + 0.15);
    if (near.length >= 6) break;
  }
  if (!near.length) return null;
  // cover that's already inside the band if there's enough of it
  const inside = near.filter((p) => p.range >= lo && p.range <= hi);
  const pool = inside.length >= 4 ? inside : near;
  const a = pool[Math.floor(rnd() * pool.length)];
  // he waits just inside the cover, so he's out a few seconds after he's sent
  const start = { x: a.x - a.outX * 5, z: a.z - a.outZ * 5 };
  const out = { x: a.x + a.outX * (12 + rnd() * 8), z: a.z + a.outZ * (12 + rnd() * 8) };
  if (!open(out.x, out.z)) return null;
  const route: P2[] = [start, { x: a.x, z: a.z }, out];
  // the spot inside the band, a short walk from where he came out (searching wider if it's blocked)
  let target: P2 | null = null;
  for (let tries = 0; tries < 16 && !target; tries++) {
    const w = 1 + tries * 0.3;
    const r0 = Math.hypot(out.x, out.z);
    // anywhere in the band, but no more than ~45 m closer (or ~10 m farther) than where he came out
    const r = Math.max(lo, Math.min(hi, Math.max(r0 - 45 * w, Math.min(r0 + 10 * w, lo + rnd() * (hi - lo)))));
    const az = Math.max(-maxAzim, Math.min(maxAzim, Math.atan2(out.x, -out.z) + (rnd() - 0.5) * (40 / r0) * w));
    const x = r * Math.sin(az), z = -r * Math.cos(az);
    if (clearPath(out, { x, z })) target = { x, z };
  }
  if (!target) return null;
  route.push(target);
  const poseAt = route.length - 1;
  // one leg across the field, mostly sideways to the shooter, staying near the band
  let cur = target;
  for (let tries = 0; tries < 12; tries++) {
    const r0 = Math.hypot(cur.x, cur.z);
    const az = Math.atan2(cur.x, -cur.z) + (rnd() - 0.5) * 0.6;
    const rr = Math.max(lo * 0.85, Math.min(hi * 1.1, r0 + (rnd() - 0.5) * 100));
    const nx = rr * Math.sin(az), nz = -rr * Math.cos(az);
    if (Math.abs(az) < maxAzim && clearPath(cur, { x: nx, z: nz })) { cur = { x: nx, z: nz }; route.push(cur); break; }
  }
  // leave at the nearest cover point that isn't where we came in
  const exits = pts.filter((p) => Math.hypot(p.x - a.x, p.z - a.z) > 60).sort((p, q) => Math.hypot(p.x - cur.x, p.z - cur.z) - Math.hypot(q.x - cur.x, q.z - cur.z));
  const e = exits[Math.floor(rnd() * Math.min(4, exits.length))];
  if (!e) return null;
  // a few steps into the cover and he's gone (no waiting on a buck you can't see)
  route.push({ x: e.x + e.outX * 3, z: e.z + e.outZ * 3 }, { x: e.x - e.outX * 6, z: e.z - e.outZ * 6 });
  return { points: route, poseAt };
}

/** Nearest cover (for a spooked or wounded buck), preferring away from `from`. */
export function nearestCover(x: number, z: number, awayX: number, awayZ: number): P2[] {
  const pts = coverPoints();
  let best: CoverPoint | null = null, bestS = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p.x - x, p.z - z);
    const dx = (p.x - x) / (d || 1), dz = (p.z - z) / (d || 1);
    const away = dx * awayX + dz * awayZ; // +1 = straight away from the threat
    const s = d * (1.4 - 0.6 * away);
    if (s < bestS) { bestS = s; best = p; }
  }
  if (!best) return [{ x: x + awayX * 200, z: z + awayZ * 200 }];
  return [{ x: best.x, z: best.z }, { x: best.x - best.outX * 8, z: best.z - best.outZ * 8 }];
}
