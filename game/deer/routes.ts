// Where bucks come from and where they go: points just inside the cover along the field
// edges, hedgerow and islands, and routes that cross the open ground between them.
import { edgeDistance, openness, sampleGround } from "../world/layout";

export type P2 = { x: number; z: number };
export type CoverPoint = P2 & { range: number; azim: number; outX: number; outZ: number };

const VIEW = (40 * Math.PI) / 180; // keep bucks inside the open view

let cache: CoverPoint[] | null = null;

/** Points on the edge of cover, with the direction pointing out into the open. */
export function coverPoints(): CoverPoint[] {
  if (cache) return cache;
  const pts: CoverPoint[] = [];
  const step = 9;
  for (let z = -1000; z < -50; z += step) {
    for (let x = -700; x <= 700; x += step) {
      const r = Math.hypot(x, z), azim = Math.atan2(x, -z);
      if (Math.abs(azim) > VIEW || r < 60 || r > 980) continue;
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

function open(x: number, z: number) { return openness(x, z) > 0.95 && sampleGround(x, z).hedge < 0.2; }

export type Route = { points: P2[]; /** index of the spot where he stops broadside */ poseAt: number };

/**
 * A route for one buck: start hidden in the cover, walk out, come to a spot inside the given
 * range band (where an easy buck stops broadside), cross the field within the band, and leave
 * into cover somewhere else. The cover may be outside the band; he walks (or trots) to it.
 */
export function makeRoute(rnd: () => number, range: [number, number], maxAzim = VIEW): Route | null {
  const pts = coverPoints();
  const [lo, hi] = range;
  const near = pts.filter((p) => p.range >= lo - 60 && p.range <= hi + 220 && Math.abs(p.azim) <= maxAzim + 0.15);
  if (!near.length) return null;
  // prefer cover close to the band, so he isn't walking for minutes
  near.sort((p, q) => Math.abs(p.range - (lo + hi) / 2) - Math.abs(q.range - (lo + hi) / 2));
  const a = near[Math.floor(Math.pow(rnd(), 2) * Math.min(near.length, 60))];
  const start = { x: a.x - a.outX * 18, z: a.z - a.outZ * 18 };
  const out = { x: a.x + a.outX * (12 + rnd() * 15), z: a.z + a.outZ * (12 + rnd() * 15) };
  if (!open(out.x, out.z)) return null;
  const route: P2[] = [start, { x: a.x, z: a.z }, out];
  // the spot inside the band, roughly in his direction from the stand
  let target: P2 | null = null;
  for (let tries = 0; tries < 16 && !target; tries++) {
    const r = lo + rnd() * (hi - lo);
    const az = Math.max(-maxAzim, Math.min(maxAzim, a.azim + (rnd() - 0.5) * 0.35));
    const x = r * Math.sin(az), z = -r * Math.cos(az);
    if (open(x, z) && open((x + out.x) / 2, (z + out.z) / 2)) target = { x, z };
  }
  if (!target) return null;
  route.push(target);
  const poseAt = route.length - 1;
  // cross the field, mostly sideways to the shooter, staying near the band
  let cur = target;
  const legs = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < legs; i++) {
    let ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      const r0 = Math.hypot(cur.x, cur.z);
      const az = Math.atan2(cur.x, -cur.z) + (rnd() - 0.5) * 0.6;
      const rr = Math.max(lo * 0.85, Math.min(hi * 1.1, r0 + (rnd() - 0.5) * 100));
      const nx = rr * Math.sin(az), nz = -rr * Math.cos(az);
      if (Math.abs(az) < maxAzim + 0.08 && open(nx, nz) && open((nx + cur.x) / 2, (nz + cur.z) / 2)) { cur = { x: nx, z: nz }; route.push(cur); ok = true; }
    }
  }
  // leave at the nearest cover point that isn't where we came in
  const exits = pts.filter((p) => Math.hypot(p.x - a.x, p.z - a.z) > 60).sort((p, q) => Math.hypot(p.x - cur.x, p.z - cur.z) - Math.hypot(q.x - cur.x, q.z - cur.z));
  const e = exits[Math.floor(rnd() * Math.min(4, exits.length))];
  if (!e) return null;
  route.push({ x: e.x + e.outX * 3, z: e.z + e.outZ * 3 }, { x: e.x - e.outX * 20, z: e.z - e.outZ * 20 });
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
  return [{ x: best.x, z: best.z }, { x: best.x - best.outX * 25, z: best.z - best.outZ * 25 }];
}
