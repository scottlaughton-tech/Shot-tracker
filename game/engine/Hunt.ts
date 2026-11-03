// One hunt: brings bucks out over the last hour of light, keeps score, and tells the
// screen what happened after every shot.
import * as THREE from "three";
import { Deer, type HitInfo } from "../deer/Deer";
import { randomRack } from "../deer/antlers";
import type { DeerAsset } from "../deer/model";
import { makeRoute } from "../deer/routes";
import { mulberry32 } from "../world/noise";
import { killScore, woundedEscape, ZONES, type BuckResult, type Part } from "../scoring";

export const BUCKS_PER_HUNT = 12;

export type Banner = { id: number; title: string; detail?: string; points?: number; tone: "good" | "bad" | "info" };

export type HuntSummary = {
  score: number;
  kills: number;
  shots: number;
  bucks: BuckResult[];
  best: string | null;
};

type Host = {
  scene: THREE.Scene;
  heightAt: (x: number, z: number) => number;
  eye: THREE.Vector3;
  roundsLeft: () => number;
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
  over = false;
  private rnd: () => number;
  private nextSpawn = 3;
  private endTimer = -1;
  private bannerId = 0;
  private bestShot: { pts: number; text: string } | null = null;
  /** per-buck: has any shot hit it yet (for one-shot kills) */
  private pendingKill = new Map<number, { parts: Part[]; total: number; text: string }>();

  constructor(private host: Host, private asset: DeerAsset, private onBanner: (b: Banner) => void, private onScore: (s: number) => void, seed = Date.now()) {
    this.rnd = mulberry32(seed);
  }

  private banner(b: Omit<Banner, "id">) { this.onBanner({ ...b, id: ++this.bannerId }); }

  private spawn() {
    let route = null;
    for (let i = 0; i < 20 && !route; i++) route = makeRoute(this.rnd);
    if (!route) return;
    const id = ++this.spawned;
    const rack = randomRack(this.rnd);
    const d = new Deer(id, this.asset, rack, route, { heightAt: this.host.heightAt, eye: this.host.eye }, {
      hit: (deer, info) => this.onHit(deer, info),
      down: (deer) => this.onDown(deer),
      escaped: (deer, wounded) => this.onEscaped(deer, wounded),
    }, this.rnd);
    this.deer.push(d);
    this.host.scene.add(d.rig.root);
    this.results.set(id, { id, antlerPoints: rack.points, status: "passed", shots: 0, score: 0, parts: [] });
    this.host.setTargets(this.deer);
  }

  update(dt: number) {
    if (this.over) return;
    for (const d of this.deer) d.update(dt);
    // remove bucks that left
    const gone = this.deer.filter((d) => d.gone);
    if (gone.length) {
      for (const d of gone) this.host.scene.remove(d.rig.root);
      this.deer = this.deer.filter((d) => !d.gone);
      this.host.setTargets(this.deer);
    }
    const active = this.deer.filter((d) => d.alive).length;
    this.nextSpawn -= dt;
    if (this.spawned < BUCKS_PER_HUNT && this.nextSpawn <= 0 && (active === 0 || (active < 2 && this.rnd() < 0.3)) && this.host.roundsLeft() > 0) {
      this.spawn();
      this.nextSpawn = 9 + this.rnd() * 14;
    }
    // the hunt ends when the rifle is empty (and every hit buck is accounted for) or the light is gone
    const unresolved = this.deer.some((d) => d.alive && (d.wounded || d.lethal));
    const outOfAmmo = this.host.roundsLeft() <= 0 && this.host.bulletsInFlight() === 0 && !unresolved;
    const allDone = this.spawned >= BUCKS_PER_HUNT && this.deer.every((d) => !d.alive || d.gone) && !unresolved;
    if ((outOfAmmo || allDone) && this.endTimer < 0) this.endTimer = outOfAmmo ? 3.5 : 2;
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.over = true;
    }
  }

  /** Every shot: deer hear it after the sound gets to them. */
  shotFired() {
    this.shotsFired++;
    for (const d of this.deer) d.hearShot(null);
  }

  /** The bullet landed somewhere; bucks right next to it bolt. */
  impact(p: THREE.Vector3 | null, missInfo: string | null) {
    if (p) for (const d of this.deer) if (d.alive && d.pos.distanceTo(p) < 25) d.hearShot(p);
    if (missInfo !== null) this.banner({ title: "Miss", detail: missInfo || undefined, tone: "info" });
  }

  private onHit(deer: Deer, info: HitInfo) {
    const r = this.results.get(deer.id)!;
    r.shots++;
    const z = ZONES[info.primary];
    const rangeTxt = `${Math.round(info.range)} m`;
    const rack = `${deer.rack.points}-pt`;
    if (info.outcome === "wound" || info.outcome === "none") {
      this.banner({
        title: info.outcome === "none" ? "Hit the antler" : `Hit – ${z.label}`,
        detail: info.outcome === "none" ? `${rack} buck at ${rangeTxt}. He's gone.` : `${rack} buck at ${rangeTxt}. Wounded – he's running! Finish him.`,
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
  }

  private onEscaped(deer: Deer, wounded: boolean) {
    const r = this.results.get(deer.id)!;
    if (wounded) {
      const w = woundedEscape();
      r.status = "wounded-escaped";
      r.score = w.total;
      r.parts = w.parts;
      this.score += w.total;
      this.onScore(this.score);
      this.banner({ title: "Wounded buck got away", points: w.total, tone: "bad" });
    } else if (r.shots === 0 && r.status === "passed") {
      r.status = "escaped";
    }
  }

  summary(): HuntSummary {
    return {
      score: this.score, kills: this.kills, shots: this.shotsFired,
      bucks: [...this.results.values()].filter((b) => b.status !== "passed" || b.shots > 0),
      best: this.bestShot?.text ?? null,
    };
  }

  dispose() {
    for (const d of this.deer) this.host.scene.remove(d.rig.root);
    this.deer = [];
  }
}
