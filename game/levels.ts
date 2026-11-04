// The level tables for both games, and small pure helpers: no three.js, so they're unit-tested
// (game/levels.test.ts). Hunt.ts runs the hunt with them.

export const STRIKES = 3;

export type Level = {
  range: [number, number];  // metres from the stand
  speed: number;            // crossing speed (m/s)
  stand: number;            // seconds standing broadside once he's out
  run: number;              // chance he comes through running instead
  azim: number;             // how far left/right of straight ahead he may appear (degrees, ≤ 30: see VIEW in routes.ts)
  note: string;             // shown when you reach the level
};

/** The ladder. Past the last level, the last one repeats. */
export const LEVELS: Level[] = [
  { range: [70, 130], speed: 1.3, stand: 16, run: 0, azim: 22, note: "Close, standing broadside." },
  { range: [110, 180], speed: 1.4, stand: 11, run: 0, azim: 26, note: "A little farther." },
  { range: [160, 250], speed: 1.5, stand: 8, run: 0, azim: 30, note: "Farther out. Mind the drop." },
  { range: [220, 330], speed: 1.6, stand: 5, run: 0, azim: 30, note: "He won't stand long." },
  { range: [280, 420], speed: 3.3, stand: 4, run: 0, azim: 30, note: "Trotting now. Lead him." },
  { range: [350, 520], speed: 3.6, stand: 3, run: 0.1, azim: 30, note: "Out past 350 m." },
  { range: [420, 650], speed: 3.8, stand: 0, run: 0.2, azim: 30, note: "Long range. He won't stop." },
  { range: [500, 800], speed: 3.8, stand: 0, run: 0.3, azim: 30, note: "Way out there." },
  { range: [600, 950], speed: 4.0, stand: 0, run: 0.4, azim: 30, note: "As far as the field goes." },
];

export function levelAt(n: number): Level { return LEVELS[Math.min(LEVELS.length, n) - 1]; }

export type HuntMode = "classic" | "turbo";

/** Turbo: seconds per level, and points per second left when you make the number. */
export const TURBO_TIME = 60;
export const TIME_BONUS = 15;

export type TurboLevel = {
  quota: number;  // bucks to drop in the minute
  atOnce: number; // most out in the field at the same time
  every: number;  // seconds between bucks coming out
  tier: number;   // which Classic level sets the ranges, speeds and light
};
export const TURBO: TurboLevel[] = [
  { quota: 3, atOnce: 2, every: 5, tier: 1 },
  { quota: 4, atOnce: 2, every: 4.5, tier: 2 },
  { quota: 5, atOnce: 3, every: 4, tier: 2 },
  { quota: 6, atOnce: 3, every: 3.5, tier: 3 },
  { quota: 7, atOnce: 3, every: 3.2, tier: 3 },
  { quota: 8, atOnce: 4, every: 3, tier: 4 },
  { quota: 9, atOnce: 4, every: 2.8, tier: 4 },
  { quota: 10, atOnce: 4, every: 2.6, tier: 5 },
];
/** Past the table: ten bucks a minute, each pair of levels a little farther out. */
export function turboAt(n: number): TurboLevel {
  if (n <= TURBO.length) return TURBO[n - 1];
  return { quota: 10, atOnce: 4, every: 2.4, tier: Math.min(LEVELS.length, 5 + Math.ceil((n - TURBO.length) / 2)) };
}

/** Where a buck is, in words, from his direction (degrees right of straight ahead). */
export function sideOf(azDeg: number): string {
  if (azDeg < -22) return "Far left.";
  if (azDeg < -7) return "On your left.";
  if (azDeg <= 7) return "Straight out front.";
  if (azDeg <= 22) return "On your right.";
  return "Far right.";
}
