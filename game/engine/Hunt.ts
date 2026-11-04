// One hunt: a ladder of levels. One buck at a time; drop him and the next one is harder
// (farther, moving faster, in dimmer light). A buck you shot at that gets away (missed or
// wounded) is a strike. Three strikes and the hunt is over. Ammunition is unlimited.
import * as THREE from "three";
import { Deer, type DeerStyle, type HitInfo } from "../deer/Deer";
import { randomRack } from "../deer/antlers";
import type { DeerAsset } from "../deer/model";
import { makeRoute } from "../deer/routes";
import { mulberry32 } from "../world/noise";
import { killScore, woundedEscape, ZONES, type BuckResult, type Part } from "../scoring";

export const STRIKES = 3;

type Level = {
  range: [number, number];  // metres from the stand
  speed: number;            // crossing speed (m/s)
  stand: number;            // seconds standing broadside once he's out
  run: number;              // chance he comes through running instead
  azim: number;             // how far left/right of straight ahead he may appear (degrees)
  note: string;             // shown when you reach the level
};

/** The ladder. Past the last level, the last one repeats. */
export const LEVELS: Level[] = [
  { range: [70, 130], speed: 1.3, stand: 16, run: 0, azim: 22, note: "Close, standing broadside." },
  { range: [110, 180], speed: 1.4, stand: 11, run: 0, azim: 28, note: "A little farther." },
  { range: [160, 250], speed: 1.5, stand: 8, run: 0, azim: 34, note: "Farther out. Mind the drop." },
  { range: [220, 330], speed: 1.6, stand: 5, run: 0, azim: 40, note: "He won't stand long." },
  { range: [280, 420], speed: 3.3, stand: 4, run: 0, azim: 40, note: "Trotting now. Lead him." },
  { range: [350, 520], speed: 3.6, stand: 3, run: 0.1, azim: 40, note: "Out past 350 m." },
  { range: [420, 650], speed: 3.8, stand: 0, run: 0.2, azim: 40, note: "Long range. He won't stop." },
  { range: [500, 800], speed: 3.8, stand: 0, run: 0.3, azim: 40, note: "Way out there." },
  { range: [600, 950], speed: 4.0, stand: 0, run: 0.4, azim: 40, note: "As far as the field goes." },
];

export function levelAt(n: number): Level { return LEVELS[Math.min(LEVELS.length, n) - 1]; }

export type Banner = { id: number; title: string; detail?: string; points?: number; tone: "good" | "bad" | "info" };
export type HuntStatus = { level: number; strikes: number };

export type HuntSummary = {
  score: number;
  kills: number;
  shots: number;
  level: number;
  bucks: BuckResult[];
  best: string | null;
};

type Host = {
  scene: THREE.Scene;
  heightAt: (x: number, z: number) => number;
  eye: THREE.Vector3;
  bulletsInFlight: () => number;
  setTargets: (t: Deer[]) => void;
};

export class Hunt {
  deer: Deer[] = [];
  results = new Map<number, BuckResult>();
  score = 0;
  kills = 0;
  shotsFired = 0;
  spawned = 0;
  level = 1;
  strikes = 0;
  over = false;
  private rnd: () => number;
  private nextSpawn = 3;
  private endTimer = -1;
  private bannerId = 0;
  private bestShot: { pts: number; text: string } | null = null;
  private pendingKill = new Map<number, { parts: Part[]; total: number; text: string }>();
  /** bucks that have been shot at (a shot fired while they were in the field) */
  private shotAt = new Set<number>();

  constructor(private host: Host, private asset: DeerAsset, private onBanner: (b: Banner) => void, private onScore: (s: number) => void,
    private onStatus: (s: HuntStatus) => void, seed = Date.now()) {
    this.rnd = mulberry32(seed);
    this.onStatus({ level: 1, strikes: 0 });
  }

  /** 0 at level 1, 1 once the sun is nearly down (level 10+). */
  get dusk() { return Math.min(1, (this.level - 1) / 9); }

  private banner(b: Omit<Banner, "id">) { this.onBanner({ ...b, id: ++this.bannerId }); }

  private spawn() {
    const L = levelAt(this.level);
    let route = null;
    for (let i = 0; i < 30 && !route; i++) route = makeRoute(this.rnd, L.range, (L.azim * Math.PI) / 180);
    for (let i = 0; i < 30 && !route; i++) route = makeRoute(this.rnd, [L.range[0] * 0.8, L.range[1] * 1.2], (40 * Math.PI) / 180);
    if (!route) { this.nextSpawn = 1; return; }
    const id = ++this.spawned;
    const rack = randomRack(this.rnd);
    const running = this.rnd() < L.run;
    const style: DeerStyle = running
      ? { speed: 9 + this.rnd() * 2.5, stand: 0, stops: false }
      : { speed: L.speed, stand: L.stand, stops: this.level < 7 };
    const d = new Deer(id, this.asset, rack, route, { heightAt: this.host.heightAt, eye: this.host.eye }, {
      hit: (deer, info) => this.onHit(deer, info),
      down: (deer) => this.onDown(deer),
      escaped: (deer, wounded) => this.onEscaped(deer, wounded),
    }, this.rnd, style);
    // only the last couple of downed bucks stay lying in the field
    const dead = this.deer.filter((x) => x.state === "dead");
    for (const x of dead.slice(0, Math.max(0, dead.length - 2))) this.host.scene.remove(x.rig.root);
    this.deer = this.deer.filter((x) => x.state !== "dead" || dead.slice(-2).includes(x));
    this.deer.push(d);
    this.host.scene.add(d.rig.root);
    this.results.set(id, { id, antlerPoints: rack.points, status: "passed", shots: 0, score: 0, parts: [] });
    this.host.setTargets(this.deer);
  }

  update(dt: number) {
    if (this.over) return;
    for (const d of this.deer) d.update(dt);
    const gone = this.deer.filter((d) => d.gone);
    if (gone.length) {
      for (const d of gone) this.host.scene.remove(d.rig.root);
      this.deer = this.deer.filter((d) => !d.gone);
      this.host.setTargets(this.deer);
    }
    const active = this.deer.filter((d) => d.alive).length;
    // one buck at a time; the next one a few seconds after the last is down or gone
    if (this.strikes < STRIKES && active === 0) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) { this.spawn(); this.nextSpawn = 4 + this.rnd() * 4; }
    }
    if (this.strikes >= STRIKES) {
      const unresolved = this.deer.some((d) => d.alive && d.lethal);
      if (!unresolved && this.host.bulletsInFlight() === 0 && this.endTimer < 0) this.endTimer = 2.5;
    }
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.over = true;
    }
  }

  /** Every shot: deer hear it after the sound gets to them. */
  shotFired() {
    this.shotsFired++;
    for (const d of this.deer) { d.hearShot(null); if (d.alive) this.shotAt.add(d.id); }
  }

  /** The bullet landed somewhere; bucks right next to it bolt. */
  impact(p: THREE.Vector3 | null, missInfo: string | null) {
    if (p) for (const d of this.deer) if (d.alive && d.pos.distanceTo(p) < 25) d.hearShot(p);
    if (missInfo !== null) this.banner({ title: "Miss", detail: missInfo || undefined, tone: "info" });
  }

  private onHit(deer: Deer, info: HitInfo) {
    const r = this.results.get(deer.id)!;
    r.shots++;
    (r.marks ??= []).push({ y: info.local.y, z: info.local.z, zone: info.primary });
    const z = ZONES[info.primary];
    const rangeTxt = `${Math.round(info.range)} m`;
    const rack = `${deer.rack.points}-pt`;
    if (info.outcome === "wound" || info.outcome === "none") {
      this.banner({
        title: info.outcome === "none" ? "Hit the antler" : `Hit – ${z.label}`,
        detail: info.outcome === "none" ? `${rack} buck at ${rangeTxt}. He's running.` : `${rack} buck at ${rangeTxt}. Wounded – finish him before he reaches the bush!`,
        tone: "bad",
      });
      return;
    }
    const ks = killScore({ zone: info.primary, range: info.range, gait: info.gait, antlerPoints: deer.rack.points, oneShot: r.shots === 1 });
    const text = `${z.label} · ${rack} · ${rangeTxt}`;
    this.pendingKill.set(deer.id, { ...ks, text });
    this.banner({ title: `${z.label}!`, detail: `${rack} buck at ${rangeTxt}${info.outcome === "drop" ? " – dropped him." : " – he won't go far."}`, points: ks.total, tone: "good" });
  }

  private onDown(deer: Deer) {
    const k = this.pendingKill.get(deer.id);
    const r = this.results.get(deer.id)!;
    if (!k) return;
    r.status = "killed";
    r.score = k.total;
    r.parts = k.parts;
    this.kills++;
    this.score += k.total;
    if (!this.bestShot || k.total > this.bestShot.pts) this.bestShot = { pts: k.total, text: k.text };
    this.onScore(this.score);
    // up a level
    this.level++;
    this.onStatus({ level: this.level, strikes: this.strikes });
    const lv = this.level;
    window.setTimeout(() => {
      if (!this.over) this.banner({ title: `Level ${lv}`, detail: levelAt(lv).note, tone: "info" });
    }, 2200);
  }

  private onEscaped(deer: Deer, wounded: boolean) {
    const r = this.results.get(deer.id)!;
    const shot = wounded || this.shotAt.has(deer.id);
    if (wounded) {
      const w = woundedEscape();
      r.status = "wounded-escaped";
      r.score = w.total;
      r.parts = w.parts;
      this.score += w.total;
      this.onScore(this.score);
    } else if (shot) {
      r.status = "escaped";
      r.parts = [{ label: "Got away", pts: 0 }];
    }
    if (shot) {
      this.strikes++;
      this.onStatus({ level: this.level, strikes: this.strikes });
      const left = STRIKES - this.strikes;
      this.banner({
        title: `${wounded ? "Wounded buck got away" : "He got away"} – strike ${this.strikes}`,
        detail: left > 0 ? `${left} ${left === 1 ? "strike" : "strikes"} left.` : "Three strikes – the hunt is over.",
        points: wounded ? r.score : undefined,
        tone: "bad",
      });
    } else {
      this.banner({ title: "He slipped back into the bush", detail: "No strike – another buck is coming.", tone: "info" });
    }
  }

  summary(): HuntSummary {
    return {
      score: this.score, kills: this.kills, shots: this.shotsFired, level: this.level,
      bucks: [...this.results.values()].filter((b) => b.status !== "passed"),
      best: this.bestShot?.text ?? null,
    };
  }

  dispose() {
    for (const d of this.deer) this.host.scene.remove(d.rig.root);
    this.deer = [];
  }
}
