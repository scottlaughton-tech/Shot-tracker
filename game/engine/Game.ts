// The game engine: owns the renderer, the scene, the two cameras (open view and scope),
// bullets, effects and the deer. React (game/ui) talks to it through the public methods
// and gets HUD updates through the `events` callbacks.
import * as THREE from "three";
import { buildSky, type SkySetup } from "../world/sky";
import { buildTerrain, type Terrain } from "../world/terrain";
import { groundMaterial } from "../world/groundMaterial";
import { noiseTexture } from "../world/textures";
import { STAND, VIEW_YAW_LIMIT } from "../world/layout";
import { drawScope } from "./reticle";
import { Effects } from "./effects";
import { Forest } from "../world/forest";
import { Grass } from "../world/grass";
import { foliageAtlas } from "../world/foliageTextures";
import { wind } from "../world/vegMaterials";
import { loadPhotos, type Photos } from "../world/photoTextures";
import { Rocks } from "../world/rocks";
import { dropTable, LOAD_308, stepBullet, zeroAngle, type BulletState } from "../ballistics";
import { buildDeerAsset, type DeerAsset } from "../deer/model";
import type { Deer } from "../deer/Deer";
import { Hunt, type Banner, type HuntSummary } from "./Hunt";
import { boltSound, hitSound, impactSound, reloadSound, shotSound } from "./audio";

export const WIDE_HFOV = 70; // degrees across the screen in the open view
export const ZOOMS = [4, 6, 8, 12, 16];
const FOV_AT_1X = 19.2; // a 4–16× hunting scope shows about 4.8° at 4×
const AIM_SENSITIVITY = 0.55; // dragging across the whole scope moves the aim ~half a scope width
const MAG_SIZE = 5;
export const ROUNDS_PER_HUNT = 10;
const BOLT_TIME = 1.25;
const RELOAD_TIME = 3.2;

export type Chamber = "ready" | "cycling" | "reloading" | "empty";

export type Hud = {
  scoped: boolean;
  zoom: number;
  rounds: number;   // left in the hunt (including the magazine)
  mag: number;      // in the magazine/chamber
  chamber: Chamber;
};

/** Something a bullet can hit (a deer). */
export interface Target {
  /** Test the segment a→b (world space). Return the hit, or null. */
  hitTest(a: THREE.Vector3, b: THREE.Vector3, bulletVel: THREE.Vector3): { t: number; onHit: () => void } | null;
}

export type GameEvents = {
  hud: (h: Hud) => void;
  banner: (b: Banner) => void;
  score: (s: number) => void;
  end: (s: HuntSummary) => void;
};

/** A bullet in flight; `aimed` is the buck it was fired at (for "missed high/low" feedback). */
type Bullet = { s: BulletState; alive: boolean; aimed: Deer | null; aimedDist: number; miss: string | null };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly wideCam = new THREE.PerspectiveCamera(36, 2, 0.1, 30000);
  readonly scopeCam = new THREE.PerspectiveCamera(2, 1, 0.5, 30000);
  terrain!: Terrain;
  sky!: SkySetup;
  effects: Effects;
  targets: Target[] = [];
  forest!: Forest;
  grass!: Grass;
  rocks!: Rocks;
  photos: Photos | null = null;
  deerAsset!: DeerAsset;
  hunt: Hunt | null = null;
  private vegView = { yaw: 99, pitch: 99, fov: 0, scoped: false };
  /** called every frame with the active camera and how magnified it is */
  updaters: ((dt: number, cam: THREE.PerspectiveCamera, magnification: number) => void)[] = [];

  private overlay: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  private raf = 0;
  private last = 0;
  time = 0;

  // aiming
  scoped = false;
  zoom = 8;
  aimYaw = 0;
  aimPitch = 0;
  private scopeCx = 0; private scopeCy = 0; private scopeD = 300;
  private recoil = { pitch: 0, yaw: 0, vp: 0, vy: 0, shake: 0 };

  // rifle
  rounds = ROUNDS_PER_HUNT;
  mag = MAG_SIZE;
  chamber: Chamber = "ready";
  private chamberTimer = 0;
  private bullets: Bullet[] = [];
  readonly eye = new THREE.Vector3(STAND.x, STAND.eye, STAND.z);

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, private events: GameEvents) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // tone mapping (?tm=aces|agx|neutral to compare while tuning)
    const tm = new URLSearchParams(location.search).get("tm");
    this.renderer.toneMapping = tm === "agx" ? THREE.AgXToneMapping : tm === "neutral" ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = Number(new URLSearchParams(location.search).get("exp")) || (tm === "agx" ? 1.0 : 0.85);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.overlay = overlay.getContext("2d")!;
    this.effects = new Effects(this.scene);
    for (const c of [this.wideCam, this.scopeCam]) c.rotation.order = "YXZ";
  }

  /** Build the world. Calls onProgress(0..1) as it goes. */
  async init(onProgress: (f: number, label: string) => void) {
    let tPrev = performance.now(), lastLabel = "start";
    const step = async (f: number, label: string) => {
      const now = performance.now();
      if (location.search.includes("debug")) console.log(`[t] ${lastLabel}: ${(now - tPrev).toFixed(0)} ms`);
      tPrev = now; lastLabel = label;
      onProgress(f, label);
      await new Promise((r) => setTimeout(r, 0));
    };
    await step(0.05, "Sky");
    this.sky = buildSky(this.scene, { azimuth: 222, elevation: 13 });
    await step(0.08, "Textures");
    this.photos = await loadPhotos(this.renderer.capabilities.getMaxAnisotropy(), (d, n) => onProgress(0.08 + 0.1 * (d / n), "Textures"));
    await step(0.18, "Ground");
    const noise = noiseTexture(256);
    this.terrain = buildTerrain(groundMaterial(noise, this.photos));
    this.scene.add(this.terrain.mesh);
    this.eye.y = this.terrain.heightAt(STAND.x, STAND.z) + STAND.eye;
    this.wideCam.position.copy(this.eye);
    this.scopeCam.position.copy(this.eye);
    await step(0.25, "Trees");
    const atlas = await foliageAtlas();
    await step(0.3, "Trees");
    this.forest = new Forest(this.renderer, this.terrain.heightAt);
    await this.forest.build(atlas, (f) => onProgress(0.25 + f * 0.65, "Trees"), this.photos);
    this.scene.add(this.forest.group);
    this.grass = new Grass(atlas, this.terrain.heightAt);
    this.scene.add(this.grass.group);
    this.rocks = new Rocks(this.terrain.heightAt, this.photos);
    this.scene.add(this.rocks.group);
    console.log(`[g] forest: ${this.forest.count} trees, ${this.forest.models.length} models`);
    await step(0.92, "Deer");
    this.deerAsset = buildDeerAsset(noise);
    await step(1, "Ready");
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    const ov = this.overlay.canvas;
    ov.width = Math.round(w * this.dpr); ov.height = Math.round(h * this.dpr);
    this.wideCam.aspect = w / h;
    const hf = THREE.MathUtils.degToRad(WIDE_HFOV);
    this.wideCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / this.wideCam.aspect));
    this.wideCam.rotation.set(THREE.MathUtils.degToRad(-2.5), 0, 0);
    this.wideCam.updateProjectionMatrix();
    this.scopeD = Math.min(h * 0.94, w * 0.58);
  }

  start() {
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  // ---------- aiming ----------

  /** finger down at a screen point: open the scope looking there */
  beginAim(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const v = new THREE.Vector3((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1, 0.5).unproject(this.wideCam).sub(this.wideCam.position).normalize();
    this.aimYaw = Math.atan2(v.x, -v.z);
    this.aimPitch = Math.asin(v.y);
    this.clampAim();
    // put the scope on the side away from the finger so the finger doesn't cover it
    this.scopeCx = x < this.w * 0.5 ? this.w * 0.57 : this.w * 0.43;
    this.scopeCx = Math.min(Math.max(this.scopeCx, this.scopeD / 2 + 4), this.w - this.scopeD / 2 - 4);
    this.scopeCy = this.h / 2;
    this.scoped = true;
    this.pushHud();
  }

  moveAim(dx: number, dy: number) {
    if (!this.scoped) return;
    const perPx = (THREE.MathUtils.degToRad(this.scopeFov()) / this.scopeD) * AIM_SENSITIVITY;
    this.aimYaw += dx * perPx;
    this.aimPitch -= dy * perPx;
    this.clampAim();
  }

  endAim() {
    this.scoped = false;
    this.pushHud();
  }

  setZoom(z: number) {
    this.zoom = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z));
    this.pushHud();
  }
  zoomStep(dir: 1 | -1) {
    const i = ZOOMS.indexOf(this.zoom);
    this.setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]);
  }

  scopeFov() { return FOV_AT_1X / this.zoom; }

  private clampAim() {
    this.aimYaw = Math.max(-VIEW_YAW_LIMIT, Math.min(VIEW_YAW_LIMIT, this.aimYaw));
    this.aimPitch = Math.max(THREE.MathUtils.degToRad(-30), Math.min(THREE.MathUtils.degToRad(15), this.aimPitch));
  }

  // ---------- shooting ----------

  fire(): boolean {
    if (!this.scoped || this.chamber !== "ready" || this.rounds <= 0) return false;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.aimPitch, -this.aimYaw, 0, "YXZ"));
    const up = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(this.aimPitch, -this.aimYaw, 0, "YXZ"));
    const right = new THREE.Vector3().crossVectors(dir, up);
    // bore points slightly up from the line of sight (zeroed at 200 m) and sits below the scope
    const bore = dir.clone().applyAxisAngle(right, zeroAngle(LOAD_308)).multiplyScalar(LOAD_308.mv);
    const origin = this.eye.clone().addScaledVector(up, -LOAD_308.sightHeight);
    // which buck was this aimed at? (closest to the crosshair, within a few degrees)
    let aimed: Deer | null = null, best = THREE.MathUtils.degToRad(3);
    const c = new THREE.Vector3();
    for (const d of this.hunt?.deer ?? []) {
      if (!d.alive) continue;
      const to = d.chest(c).sub(this.eye);
      const ang = to.angleTo(dir);
      if (ang < best) { best = ang; aimed = d; }
    }
    this.bullets.push({
      s: { p: [origin.x, origin.y, origin.z], v: [bore.x, bore.y, bore.z], t: 0 }, alive: true,
      aimed, aimedDist: aimed ? aimed.chest(c).distanceTo(this.eye) : 0, miss: null,
    });
    this.hunt?.shotFired();

    this.rounds--;
    this.mag--;
    this.recoil.vp = 0.9 + Math.random() * 0.2;
    this.recoil.vy = (Math.random() - 0.5) * 0.25;
    this.recoil.shake = 1;
    shotSound();
    if (this.rounds <= 0) this.chamber = "empty";
    else if (this.mag <= 0) { this.chamber = "reloading"; this.chamberTimer = RELOAD_TIME; reloadSound(); }
    else { this.chamber = "cycling"; this.chamberTimer = BOLT_TIME; boltSound(0.45); }
    this.pushHud();
    return true;
  }

  private updateBullets(dt: number) {
    const sub = 0.001;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), vel = new THREE.Vector3();
    for (const bl of this.bullets) {
      if (!bl.alive) continue;
      let left = dt;
      while (left > 0 && bl.alive) {
        const h = Math.min(sub, left);
        left -= h;
        a.set(bl.s.p[0], bl.s.p[1], bl.s.p[2]);
        stepBullet(bl.s, h, LOAD_308.bc);
        b.set(bl.s.p[0], bl.s.p[1], bl.s.p[2]);
        vel.set(bl.s.v[0], bl.s.v[1], bl.s.v[2]);
        // deer first (closest hit along the segment)
        let best: { t: number; onHit: () => void } | null = null;
        for (const tg of this.targets) {
          const hit = tg.hitTest(a, b, vel);
          if (hit && (!best || hit.t < best.t)) best = hit;
        }
        if (best) {
          bl.alive = false;
          best.onHit();
          const hp = a.clone().lerp(b, best.t);
          this.effects.hair(hp);
          const range = hp.distanceTo(this.eye);
          hitSound(range / 337, range);
          break;
        }
        // passing the buck it was aimed at: note how far off it was
        if (bl.aimed && bl.miss === null && b.distanceTo(this.eye) >= bl.aimedDist) bl.miss = this.describeMiss(b, bl.aimed);
        const gh = this.terrain.heightAt(b.x, b.z);
        if (b.y <= gh) {
          bl.alive = false;
          const ha = this.terrain.heightAt(a.x, a.z);
          const f = (a.y - ha) / Math.max(1e-6, (a.y - ha) - (b.y - gh));
          const p = a.clone().lerp(b, f);
          p.y = this.terrain.heightAt(p.x, p.z);
          this.effects.dust(p);
          const range = p.distanceTo(this.eye);
          if (range < 450) impactSound(range / 337, range);
          // landed short of the buck it was aimed at: that's a low miss
          if (bl.aimed && bl.miss === null) bl.miss = p.distanceTo(this.eye) < bl.aimedDist - 3 ? "low – hit the dirt in front of him" : "";
          this.hunt?.impact(p, bl.miss ?? "");
        } else if (bl.s.t > 4) {
          bl.alive = false;
          this.hunt?.impact(null, bl.miss ?? "");
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  /** "40 cm high · 1.2 m behind" relative to the buck's chest. */
  private describeMiss(p: THREE.Vector3, d: Deer): string {
    const chest = d.chest();
    const off = p.clone().sub(chest);
    const los = chest.clone().sub(this.eye).normalize();
    const side = new THREE.Vector3().crossVectors(los, new THREE.Vector3(0, 1, 0)).normalize();
    const lat = off.dot(side);
    const up = off.y;
    // which way is the buck moving across the view?
    const vel = new THREE.Vector3(Math.sin(d.heading), 0, Math.cos(d.heading)).multiplyScalar(d.speed);
    const across = vel.dot(side);
    const fmt = (m: number) => (Math.abs(m) >= 1 ? `${Math.abs(m).toFixed(1)} m` : `${Math.round(Math.abs(m) * 100)} cm`);
    const parts: string[] = [];
    if (Math.abs(up) > 0.12) parts.push(`${fmt(up)} ${up > 0 ? "high" : "low"}`);
    if (Math.abs(lat) > 0.15) {
      if (Math.abs(across) > 0.5) parts.push(`${fmt(lat)} ${Math.sign(lat) === Math.sign(across) ? "ahead" : "behind"}`);
      else parts.push(`${fmt(lat)} ${lat > 0 ? "right" : "left"}`);
    }
    return parts.join(" · ");
  }

  // ---------- hunt ----------

  startHunt() {
    this.hunt?.dispose();
    this.rounds = ROUNDS_PER_HUNT;
    this.mag = MAG_SIZE;
    this.chamber = "ready";
    this.bullets = [];
    this.endedSent = false;
    this.paused = false;
    this.huntTime = 0;
    this.sky.setLight(0);
    this.hunt = new Hunt({
      scene: this.scene,
      heightAt: this.terrain.heightAt,
      eye: this.eye,
      roundsLeft: () => this.rounds,
      bulletsInFlight: () => this.bullets.length,
      setTargets: (t) => { this.targets = t; },
      dusk: () => this.huntTime / Game.HUNT_LENGTH,
    }, this.deerAsset, this.events.banner, this.events.score);
    this.events.score(0);
    this.pushHud();
  }
  private endedSent = false;
  /** paused: the world keeps drawing but nothing moves (menu open, app in background) */
  paused = false;
  private huntTime = 0;
  static HUNT_LENGTH = 330; // seconds of "last light"

  // ---------- frame ----------

  /** Testing only: point the rifle where a perfect shot would go (drop + lead). */
  debugPerfectAim(d: Deer, offset = new THREE.Vector3()) {
    let target = d.chest().add(offset);
    const vel = new THREE.Vector3(Math.sin(d.heading), 0, Math.cos(d.heading)).multiplyScalar(d.speed);
    for (let i = 0; i < 3; i++) {
      const range = target.distanceTo(this.eye);
      const [row] = dropTable(LOAD_308, [range]);
      target = d.chest().add(offset).addScaledVector(vel, row.tof);
      const to = target.clone().sub(this.eye).normalize();
      this.aimYaw = Math.atan2(to.x, -to.z);
      this.aimPitch = Math.asin(to.y) + -row.drop / range;
    }
  }

  /** Testing only: look through the scope in a given direction (degrees). */
  debugView(yawDeg: number, pitchDeg: number, zoom: number) {
    this.scoped = true;
    this.scopeCx = this.w / 2; this.scopeCy = this.h / 2;
    this.aimYaw = THREE.MathUtils.degToRad(yawDeg);
    this.aimPitch = THREE.MathUtils.degToRad(pitchDeg);
    this.setZoom(zoom);
  }

  /** Testing only: run the simulation forward without drawing. */
  debugAdvance(seconds: number) {
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) this.tick(dt, false);
  }

  // adaptive resolution: drop the pixel ratio when frames are slow, raise it when there's room
  private frameAvg = 16;
  private dprScale = 1;
  private adapt(dtMs: number) {
    this.frameAvg += (dtMs - this.frameAvg) * 0.05;
    if (this.frames % 90 !== 0) return;
    const max = Math.min(window.devicePixelRatio || 1, 2);
    let next = this.dprScale;
    if (this.frameAvg > 34 && this.dprScale > 0.55) next = this.dprScale - 0.15;
    else if (this.frameAvg < 20 && this.dprScale < 1) next = Math.min(1, this.dprScale + 0.1);
    if (next !== this.dprScale) {
      this.dprScale = next;
      this.renderer.setPixelRatio(Math.max(1, max * next));
      this.renderer.setSize(this.w, this.h, false);
    }
  }

  private frames = 0;
  private tick(dt: number, draw = true) {
    if (this.paused) { if (draw) this.render(); return; }
    this.time += dt;
    if (++this.frames % 60 === 0 && location.search.includes("debug")) console.log(`[g] frame dt ${(dt * 1000).toFixed(0)} ms, calls ${this.renderer.info.render.calls}, tris ${this.renderer.info.render.triangles}`);
    if (this.chamber === "cycling" || this.chamber === "reloading") {
      this.chamberTimer -= dt;
      if (this.chamberTimer <= 0) {
        if (this.chamber === "reloading") this.mag = Math.min(MAG_SIZE, this.rounds);
        this.chamber = "ready";
        this.pushHud();
      }
    }
    // recoil: a kick up, then a damped return
    const r = this.recoil;
    r.pitch += r.vp * dt * 6; r.yaw += r.vy * dt * 6;
    r.vp *= Math.exp(-dt * 14); r.vy *= Math.exp(-dt * 14);
    r.pitch *= Math.exp(-dt * 5.5); r.yaw *= Math.exp(-dt * 5.5);
    r.shake *= Math.exp(-dt * 9);

    this.updateBullets(dt);
    if (this.hunt) {
      this.huntTime += dt;
      if (this.frames % 30 === 0) this.sky.setLight(Math.min(1, this.huntTime / Game.HUNT_LENGTH));
      this.hunt.update(dt);
      if (this.hunt.over && !this.endedSent) { this.endedSent = true; this.scoped = false; this.pushHud(); this.events.end(this.hunt.summary()); }
    }
    this.effects.update(dt);
    this.sky.update(this.time);
    wind.uTime.value = this.time;

    const cam = this.scoped ? this.scopeCam : this.wideCam;
    if (this.scoped) {
      this.scopeCam.fov = this.scopeFov();
      this.scopeCam.aspect = 1;
      this.scopeCam.rotation.set(this.aimPitch + r.pitch * 0.06, -this.aimYaw - r.yaw * 0.03, 0);
      this.scopeCam.updateProjectionMatrix();
    }
    const mag = this.scoped ? WIDE_HFOV / this.scopeFov() * (this.scopeD / this.w) : 1;
    for (const u of this.updaters) u(dt, cam, mag);
    this.refreshVegetation(mag);
    if (!draw) return;
    if (!location.search.includes("debug")) this.adapt(dt * 1000);
    // shadows: refresh every other frame (every 3rd in the open view)
    this.renderer.shadowMap.autoUpdate = false;
    if (this.frames % (this.scoped ? 2 : 3) === 0) { this.fitShadows(); this.renderer.shadowMap.needsUpdate = true; }
    this.render();
  }

  /**
   * Trees (full model vs impostor) and grass depend on where we look and how magnified.
   * They're rebuilt with a margin, only when the view has moved a quarter of its width.
   */
  private refreshVegetation(mag: number) {
    const fovDeg = this.scoped ? this.scopeFov() : WIDE_HFOV;
    const fov = THREE.MathUtils.degToRad(fovDeg);
    const yaw = this.scoped ? this.aimYaw : 0;
    const pitch = this.scoped ? this.aimPitch : this.wideCam.rotation.x;
    const v = this.vegView;
    const moved = Math.max(Math.abs(yaw - v.yaw), Math.abs(pitch - v.pitch)) > fov * 0.18;
    if (!moved && v.fov === fovDeg && v.scoped === this.scoped) return;
    Object.assign(v, { yaw, pitch, fov: fovDeg, scoped: this.scoped });
    const margin = this.scoped ? 1.45 : 1.1;
    this.forest.update(yaw, (fov / 2) * margin + 0.002, mag);
    this.rocks.update(yaw, (fov / 2) * margin + 0.002, mag);
    // ground distances visible at the bottom and top of the view
    let rMin: number, rMax: number;
    if (this.scoped) {
      const at = (p: number) => {
        const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(p, -yaw, 0, "YXZ"));
        const hit = this.groundAlong(d);
        return hit ? Math.hypot(hit.x - this.eye.x, hit.z - this.eye.z) : null;
      };
      const lo = at(pitch - fov * 0.62), mid = at(pitch), hi = at(pitch + fov * 0.62);
      rMin = (lo ?? mid ?? 200) * 0.96;
      rMax = Math.min((hi ?? (mid ? mid * 1.5 : (lo ?? 200) * 2.5)) * 1.04, (rMin + 5) * 3);
    } else {
      rMin = 5; rMax = 360;
    }
    this.grass.update(rMin, rMax, yaw, (fov / 2) * margin + 0.002, mag);
  }

  private fitShadows() {
    const sun = this.sky.sun;
    const cam = this.scoped ? this.scopeCam : this.wideCam;
    // focus point: where the view centre meets the ground (scope), or the middle of the field
    let focus: THREE.Vector3, half: number;
    if (this.scoped) {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
      focus = this.groundAlong(dir) ?? this.eye.clone().addScaledVector(dir, 300);
      const dist = focus.distanceTo(this.eye);
      half = Math.max(20, dist * Math.tan(THREE.MathUtils.degToRad(this.scopeFov())) * 1.2);
    } else {
      focus = new THREE.Vector3(0, 0, -480);
      half = 640;
    }
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(this.sky.sunDir, 800);
    const sc = sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = 1600;
    sc.updateProjectionMatrix();
  }

  /** first point where a ray from the eye meets the ground */
  groundAlong(dir: THREE.Vector3): THREE.Vector3 | null {
    const p = this.eye.clone();
    let step = 2;
    for (let d = 0; d < 3000; d += step) {
      p.copy(this.eye).addScaledVector(dir, d);
      if (p.y < this.terrain.heightAt(p.x, p.z)) {
        // refine
        let lo = d - step, hi = d;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          p.copy(this.eye).addScaledVector(dir, m);
          if (p.y < this.terrain.heightAt(p.x, p.z)) hi = m; else lo = m;
        }
        return p.copy(this.eye).addScaledVector(dir, hi);
      }
      step = Math.max(2, d * 0.01);
    }
    return null;
  }

  private render() {
    const rd = this.renderer;
    const ctx = this.overlay;
    if (!this.scoped) {
      rd.setScissorTest(false);
      rd.setViewport(0, 0, this.w, this.h);
      rd.clear();
      rd.render(this.scene, this.wideCam);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    const d = this.scopeD, x0 = this.scopeCx - d / 2, y0 = this.scopeCy - d / 2;
    rd.setScissorTest(false);
    rd.setClearColor(0x000000, 1);
    rd.clear();
    rd.setScissorTest(true);
    rd.setViewport(x0, this.h - y0 - d, d, d);
    rd.setScissor(x0, this.h - y0 - d, d, d);
    rd.render(this.scene, this.scopeCam);
    rd.setScissorTest(false);
    const pxPerMil = d / (THREE.MathUtils.degToRad(this.scopeFov()) * 1000);
    const s = this.recoil.shake;
    drawScope(ctx, {
      w: this.w, h: this.h, dpr: this.dpr, cx: this.scopeCx, cy: this.scopeCy, d,
      pxPerMil, zoom: this.zoom,
      jx: (Math.random() - 0.5) * 10 * s, jy: -14 * s + (Math.random() - 0.5) * 6 * s,
    });
  }

  pushHud() {
    this.events.hud({ scoped: this.scoped, zoom: this.zoom, rounds: this.rounds, mag: this.mag, chamber: this.chamber });
  }
}
