// Hit zones, what each does to a buck, and how a hunt is scored. Pure, no imports.

export type Zone =
  | "brain" | "spine" | "heart" | "lungs" | "neck" | "liver"
  | "shoulder" | "paunch" | "back" | "ham" | "leg" | "jaw" | "antler";

/** What happens to the buck: drops on the spot, dies after a short/medium/long run, or is only wounded. */
export type Outcome = "drop" | "short" | "run" | "long" | "wound" | "none";

export type Gait = "stand" | "walk" | "trot" | "run";

export const ZONES: Record<Zone, { label: string; points: number; outcome: Outcome; rank: number }> = {
  // rank: when one bullet passes through several zones, the highest rank decides the result
  brain:    { label: "Head (brain)",       points: 100, outcome: "drop",  rank: 12 },
  heart:    { label: "Heart",              points: 100, outcome: "short", rank: 11 },
  spine:    { label: "Spine",              points: 70,  outcome: "drop",  rank: 10 },
  lungs:    { label: "Lungs",              points: 90,  outcome: "run",   rank: 9 },
  neck:     { label: "Neck",               points: 75,  outcome: "drop",  rank: 8 },
  liver:    { label: "Liver",              points: 50,  outcome: "long",  rank: 7 },
  shoulder: { label: "Shoulder",           points: 20,  outcome: "wound", rank: 6 },
  paunch:   { label: "Gut",                points: 10,  outcome: "wound", rank: 5 },
  back:     { label: "High back",          points: 10,  outcome: "wound", rank: 4.5 },
  ham:      { label: "Rump / hindquarter", points: 15,  outcome: "wound", rank: 4 },
  leg:      { label: "Leg",                points: 5,   outcome: "wound", rank: 3 },
  jaw:      { label: "Jaw / nose",         points: 5,   outcome: "wound", rank: 2 },
  antler:   { label: "Antler",             points: 0,   outcome: "none",  rank: 1 },
};

/** The zone that decides the result when a bullet passes through several. */
export function primaryZone(zones: Zone[]): Zone | null {
  let best: Zone | null = null;
  for (const z of zones) if (!best || ZONES[z].rank > ZONES[best].rank) best = z;
  return best;
}

export function isLethal(z: Zone | null): boolean {
  if (!z) return false;
  const o = ZONES[z].outcome;
  return o === "drop" || o === "short" || o === "run" || o === "long";
}

export const SCORE = {
  killBase: 100,
  oneShotBonus: 50,
  perAntlerPoint: 10,
  woundedEscapePenalty: 75,
  motion: { stand: 0, walk: 25, trot: 60, run: 120 } as Record<Gait, number>,
  /** +1 point for every 5 m beyond 100 m */
  rangeBonus: (m: number) => Math.round(Math.max(0, m - 100) / 5),
};

export type Part = { label: string; pts: number };

/** Points for a killed buck, itemised for the score card. */
export function killScore(k: { zone: Zone; range: number; gait: Gait; antlerPoints: number; oneShot: boolean }): { total: number; parts: Part[] } {
  const parts: Part[] = [
    { label: "Buck down", pts: SCORE.killBase },
    { label: ZONES[k.zone].label, pts: ZONES[k.zone].points },
  ];
  const rb = SCORE.rangeBonus(k.range);
  if (rb) parts.push({ label: `${Math.round(k.range)} m shot`, pts: rb });
  if (SCORE.motion[k.gait]) parts.push({ label: `${k.gait === "run" ? "Running" : k.gait === "trot" ? "Trotting" : "Walking"} buck`, pts: SCORE.motion[k.gait] });
  if (k.oneShot) parts.push({ label: "One-shot kill", pts: SCORE.oneShotBonus });
  if (k.antlerPoints) parts.push({ label: `${k.antlerPoints}-point rack`, pts: k.antlerPoints * SCORE.perAntlerPoint });
  return { total: parts.reduce((s, p) => s + p.pts, 0), parts };
}

export type BuckStatus = "killed" | "wounded-escaped" | "escaped" | "passed";

export type BuckResult = {
  id: number;
  antlerPoints: number;
  status: BuckStatus;
  shots: number;
  score: number;
  parts: Part[];
  /** where each bullet went in, side view in the buck's own metres (z forward, y up) */
  marks?: { y: number; z: number; zone: Zone }[];
};

export function woundedEscape(): { total: number; parts: Part[] } {
  return { total: -SCORE.woundedEscapePenalty, parts: [{ label: "Wounded buck got away", pts: -SCORE.woundedEscapePenalty }] };
}

export function huntTotal(bucks: BuckResult[]): number {
  return bucks.reduce((s, b) => s + b.score, 0);
}
