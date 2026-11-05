// One hunt: a ladder of levels, in one of two modes. Ammunition is unlimited in both.
//  - Classic: one buck at a time; drop him and the next one is harder (farther, moving faster, in
//    dimmer light). A buck you shot at that gets away (missed or wounded) is a strike; three
//    strikes and the hunt is over.
//  - Turbo: each level is one minute to drop a number of bucks. Several are out at once and they
//    keep coming; every level wants more, sends them faster and farther out. Make the number and
//    the seconds left are bonus points; run out of time and the hunt is over.
import * as THREE from "three";
import { Deer, type DeerStyle, type HitInfo } from "../deer/Deer";
import { randomRack } from "../deer/antlers";
import type { DeerAsset } from "../deer/model";
import { makeRoute } from "../deer/routes";
import { mulberry32 } from "../world/noise";
import { killScore, woundedEscape, ZONES, type BuckResult, type Part } from "../scoring";
import { tickSound } from "./audio";

import { levelAt, sideOf, STRIKES, TIME_BONUS, TURBO_TIME, turboAt, type HuntMode } from "../levels";
export { LEVELS, levelAt, sideOf, STRIKES, TIME_BONUS, TURBO, TURBO_TIME, turboAt, type HuntMode } from "../levels";

export type Banner = { id: number; title: string; detail?: string; points?: number; tone: "good" | "bad" | "info" | "alert" };
export type HuntStatus = {
  level: number;
  strikes: number;
  mode: HuntMode;
  /** Turbo only: whole seconds left, bucks down this level, and how many it wants */
  timeLeft?: number;
  dropped?: number;
  quota?: number;
};

export type HuntSummary = {
  mode: HuntMode;
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
  /** a buck just stepped out (for the on-screen marker and the chime) */
  buckOut?: (d: Deer) => void;
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
  private nextSpawn = 1.5;
  private endTimer = -1;
  private bannerId = 0;
  private bestShot: { pts: number; text: string } | null = null;
  private pendingKill = new Map<number, { parts: Part[]; total: number; text: string }>();
  /** bucks that have been shot at (a shot fired while they were in the field) */
  private shotAt = new Set<number>();

  // Turbo
  timeLeft = TURBO_TIME;
  dropped = 0;
  private phase: "play" | "overtime" | "break" = "play";
  /** bucks already counted toward a Turbo level (a fatal hit counts once, the moment it lands) */
  private counted = new Set<number>();
  private breakLeft = 0;
  private shownSec = -1;

  constructor(private host: Host, private asset: DeerAsset, private onBanner: (b: Banner) => void, private onScore: (s: number) => void,
    private onStatus: (s: HuntStatus) => void, readonly mode: HuntMode = "classic", seed = Date.now()) {
    this.rnd = mulberry32(seed);
    if (mode === "turbo") {
      this.nextSpawn = 1;
      this.banner({ title: "Level 1", detail: `Drop ${turboAt(1).quota} bucks in a minute.`, tone: "info" });
    }
    this.emitStatus();
  }

  private emitStatus() {
    if (this.mode === "classic") { this.onStatus({ level: this.level, strikes: this.strikes, mode: "classic" }); return; }
    this.shownSec = Math.ceil(this.timeLeft);
    this.onStatus({ level: this.level, strikes: 0, mode: "turbo", timeLeft: this.shownSec, dropped: this.dropped, quota: turboAt(this.level).quota });
  }

  /** Turbo: no shooting once the clock has run out or between levels (shots already fired still count). */
  get canShoot() { return this.mode === "classic" || this.phase === "play"; }

  /** Bucks hit hard that haven't hit the ground yet (running, or falling: "dying"). */
  private get stillGoingDown() { return this.deer.filter((d) => d.lethal && d.state !== "dead" && d.state !== "gone").length; }

  /** The Classic level whose ranges, speeds and light apply now. */
  private get tier() { return this.mode === "turbo" ? turboAt(this.level).tier : this.level; }

  /** 0 at the first level, 1 once the sun is nearly down. */
  get dusk() { return Math.min(1, (this.tier - 1) / 9); }

  private banner(b: Omit<Banner, "id">) { this.onBanner({ ...b, id: ++this.bannerId }); }

  private spawn() {
    const L = levelAt(this.tier);
    let route = null;
    for (let i = 0; i < 30 && !route; i++) route = makeRoute(this.rnd, L.range, (L.azim * Math.PI) / 180);
    for (let i = 0; i < 30 && !route; i++) route = makeRoute(this.rnd, [L.range[0] * 0.8, L.range[1] * 1.2], (40 * Math.PI) / 180);
    if (!route) { this.nextSpawn = 1; return; }
    const id = ++this.spawned;
    const rack = randomRack(this.rnd);
    const running = this.rnd() < L.run;
    const turbo = this.mode === "turbo";
    const style: DeerStyle = running
      ? { speed: 9 + this.rnd() * 2.5, stand: 0, stops: false }
      // Turbo bucks don't hang about: half the standing time, no stopping to feed
      : { speed: L.speed, stand: turbo ? Math.round(L.stand / 2) : L.stand, stops: !turbo && this.tier < 7 };
    const d = new Deer(id, this.asset, rack, route, { heightAt: this.host.heightAt, eye: this.host.eye }, {
      out: (deer) => this.onOut(deer),
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
    if (this.mode === "turbo") { this.updateTurbo(dt); return; }
    const active = this.deer.filter((d) => d.alive).length;
    // one buck at a time; the next one a couple of seconds after the last is down or gone
    if (this.strikes < STRIKES && active === 0) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) { this.spawn(); this.nextSpawn = 2 + this.rnd() * 1.5; }
    }
    if (this.strikes >= STRIKES) {
      const unresolved = this.stillGoingDown > 0;
      if (!unresolved && this.host.bulletsInFlight() === 0 && this.endTimer < 0) this.endTimer = 2.5;
    }
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.over = true;
    }
  }

  private updateTurbo(dt: number) {
    const T = turboAt(this.level);
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.over = true;
      return;
    }
    if (this.phase === "break") {
      this.breakLeft -= dt;
      if (this.breakLeft <= 0) {
        this.level++;
        this.timeLeft = TURBO_TIME;
        this.dropped = 0;
        this.phase = "play";
        this.nextSpawn = 1;
        this.banner({ title: `Level ${this.level}`, detail: `Drop ${turboAt(this.level).quota} bucks in a minute.`, tone: "info" });
        this.emitStatus();
      }
      return;
    }
    const roamers = this.deer.filter((d) => d.alive && !d.lethal);
    if (this.phase === "play") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      // keep them coming: up to `atOnce` out, but not more than are still needed (plus one)
      const need = T.quota - this.dropped;
      const roaming = roamers.length;
      this.nextSpawn -= dt;
      if (roaming === 0) this.nextSpawn = Math.min(this.nextSpawn, 1);
      if (need > 0 && roaming < Math.min(T.atOnce, need + 1) && this.nextSpawn <= 0) {
        this.spawn();
        this.nextSpawn = T.every * (0.8 + this.rnd() * 0.4);
      }
      const sec = Math.ceil(this.timeLeft);
      if (sec !== this.shownSec) {
        if (sec <= 5 && sec > 0) tickSound(sec === 1);
        this.emitStatus();
      }
      if (this.dropped >= T.quota) return this.levelCleared(true);
      if (this.timeLeft <= 0) {
        // the buzzer: no more shooting, but bullets already on their way still count
        this.phase = "overtime";
        for (const d of roamers) d.spook();
      }
      return;
    }
    // overtime: a bullet fired before the buzzer may still make the number; otherwise, once the
    // bucks already hit have gone down (so their points are in), the hunt is over
    if (this.dropped >= T.quota) return this.levelCleared(false);
    if (this.stillGoingDown === 0 && this.host.bulletsInFlight() === 0) {
      this.banner({ title: "Time's up", detail: `${this.dropped} of ${T.quota} down – the hunt is over.`, tone: "bad" });
      this.endTimer = 2.5;
    }
  }

  private levelCleared(inTime: boolean) {
    const secs = inTime ? Math.floor(this.timeLeft) : 0;
    const bonus = secs * TIME_BONUS;
    this.score += bonus;
    this.onScore(this.score);
    this.banner({
      title: `Level ${this.level} done!`,
      detail: secs > 0 ? `${secs} seconds to spare.` : "Just made it.",
      points: bonus || undefined,
      tone: "good",
    });
    // the rest head for the bush; the next level starts after a short breather
    for (const d of this.deer) if (d.alive && !d.lethal) d.spook();
    this.phase = "break";
    this.breakLeft = 3.5;
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

  private onOut(deer: Deer) {
    if (this.over || !deer.alive) return;
    // (in Turbo they come thick and fast: the chime and the marker are enough)
    if (this.mode === "classic") this.banner({ title: "Buck out!", detail: sideOf((deer.azimuth() * 180) / Math.PI), tone: "alert" });
    this.host.buckOut?.(deer);
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
    // Turbo: a fatal hit counts toward the level the moment it lands, even if he runs a little
    // before he drops (his points come when he does)
    if (this.mode === "turbo" && this.phase !== "break" && !this.counted.has(deer.id)) {
      this.counted.add(deer.id);
      this.dropped++;
      this.emitStatus();
    }
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
    if (this.mode === "turbo") return; // (he was counted toward the level when he was hit)
    // up a level
    this.level++;
    this.emitStatus();
    const lv = this.level;
    window.setTimeout(() => {
      if (!this.over) this.banner({ title: `Level ${lv}`, detail: levelAt(lv).note, tone: "info" });
    }, 2200);
  }

  private onEscaped(deer: Deer, wounded: boolean) {
    const r = this.results.get(deer.id)!;
    const shot = wounded || this.shotAt.has(deer.id);
    if (this.mode === "turbo") {
      // no strikes in Turbo; a wounded buck that gets away still costs points
      if (wounded) {
        const w = woundedEscape();
        r.status = "wounded-escaped";
        r.score = w.total;
        r.parts = w.parts;
        this.score += w.total;
        this.onScore(this.score);
        this.banner({ title: "Wounded buck got away", points: w.total, tone: "bad" });
      } else if (shot) {
        r.status = "escaped";
        r.parts = [{ label: "Got away", pts: 0 }];
      }
      return;
    }
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
      this.emitStatus();
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
      mode: this.mode, score: this.score, kills: this.kills, shots: this.shotsFired, level: this.level,
      bucks: [...this.results.values()].filter((b) => b.status !== "passed"),
      best: this.bestShot?.text ?? null,
    };
  }

  dispose() {
    for (const d of this.deer) this.host.scene.remove(d.rig.root);
    this.deer = [];
  }
}
