// The game engine: owns the renderer, the scene, the two cameras (open view and scope),
// bullets, effects and the deer. React (game/ui) talks to it through the public methods
// and gets HUD updates through the `events` callbacks.
import * as THREE from "three";
import { buildSky, skyEnvironment, type SkySetup } from "../world/sky";
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
import { buildFence } from "../world/fence";
import { dropTable, LOAD_308, stepBullet, zeroAngle, type BulletState } from "../ballistics";
import { buildDeerAsset, type DeerAsset } from "../deer/model";
import type { Deer } from "../deer/Deer";
import { Hunt, type Banner, type HuntMode, type HuntStatus, type HuntSummary } from "./Hunt";
import { alertSound, boltSound, hitSound, impactSound, reloadSound, setListenerYaw, shotSound } from "./audio";

export const WIDE_HFOV = 70; // degrees across the screen in the open view
export const ZOOMS = [4, 6, 8, 12, 16];
const FOV_AT_1X = 19.2; // a 4–16× hunting scope shows about 4.8° at 4×
const AIM_SENSITIVITY = 0.65; // a slow drag across the whole scope moves the aim ~2/3 of a scope width
const DRAG_GAIN = 1; // "drag the view": the picture moves with the finger
const MAG_SIZE = 5;
const ALERT_TIME = 3.5; // seconds the "buck out" marker shows
// ammunition is unlimited (the hunt ends on three strikes); the magazine still holds 5
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
  status: (s: HuntStatus) => void;
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
  private grassView = { yaw: 99, pitch: 99, fov: 0, scoped: false };
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
  rounds = Infinity;
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
    this.sky = buildSky(this.scene, { azimuth: 236, elevation: 12 }); // early-November late afternoon, WSW
    if (!location.search.includes("noenv")) {
      this.env = skyEnvironment(this.renderer, this.scene, this.sky);
      this.env.update(0);
      this.scene.environmentIntensity = Number(new URLSearchParams(location.search).get("env")) || 0.07; // the sky model is very bright; a little goes a long way
      this.sky.hemi.intensity *= 0.45; // the sky light now comes from the environment; keep some ground bounce
    }
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
    this.scene.add(buildFence(this.terrain.heightAt));
    console.log(`[g] forest: ${this.forest.count} trees, ${this.forest.models.length} models`);
    this.addStandRail();
    await step(0.92, "Deer");
    this.deerAsset = buildDeerAsset(noise);
    await step(1, "Ready");
  }

  /** The ladder stand's padded shooting rail across the bottom of the open view (not in the scope). */
  private addStandRail() {
    const g = new THREE.Group();
    const pad = new THREE.MeshStandardMaterial({ color: "#3b3a2c", roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: "#2a2b27", roughness: 0.6, metalness: 0.4 });
    const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.5, 6, 12), pad);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, -0.62, -0.78);
    // stitched seams on the padding: a few darker rings
    for (let i = -3; i <= 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.004, 6, 16), steel);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(i * 0.22, -0.62, -0.78);
      g.add(ring);
    }
    for (const x of [-0.78, 0.78]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), steel);
      post.position.set(x, -1.05, -0.7);
      post.rotation.x = -0.25;
      g.add(post);
    }
    g.add(rail);
    g.traverse((o) => { o.layers.set(1); });
    g.position.copy(this.eye);
    this.scene.add(g);
    this.wideCam.layers.enable(1);
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
    this.scopeD = Math.min(h - 62, w * 0.5); // leaves room for the top bar
    if (this.scoped) this.placeScope();
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

  /** dimmed still of the open view, shown around the scope so you can see where it's pointed */
  private snapRT: THREE.WebGLRenderTarget | null = null;
  private snapScene: THREE.Scene | null = null;
  private snapMat: THREE.ShaderMaterial | null = null;
  private snapCam = (() => { const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); c.position.z = 0.5; return c; })();
  private lastMove = 0;

  private dirAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    return new THREE.Vector3((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1, 0.5).unproject(this.wideCam).sub(this.wideCam.position).normalize();
  }

  private aimAt(clientX: number, clientY: number) {
    const v = this.dirAt(clientX, clientY);
    this.aimYaw = Math.atan2(v.x, -v.z);
    this.aimPitch = Math.asin(v.y);
    this.clampAim();
  }

  /** Tap on the field: the scope comes up right there, over the spot, and stays up. */
  openScope(clientX: number, clientY: number) {
    if (!this.scoped) this.takeSnapshot();
    this.aimAt(clientX, clientY);
    this.scoped = true;
    this.placeScope();
    this.pushHud();
  }

  /** While the scope is up, a tap somewhere else on the field moves it there. */
  jumpScope(clientX: number, clientY: number) {
    if (!this.scoped) return this.openScope(clientX, clientY);
    this.aimAt(clientX, clientY);
    this.placeScope();
  }

  /** Is this screen point inside the scope circle? */
  insideScope(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return Math.hypot(clientX - rect.left - this.scopeCx, clientY - rect.top - this.scopeCy) < this.scopeD / 2;
  }

  /** Player settings: "drag the view" (the picture follows the finger) and an aim speed factor. */
  dragView = false;
  aimSpeed = 1;
  private dragSpeed = 0;

  /**
   * Slide to aim (relative, like a trackpad; quick swipes go farther). Normally the scope aims the
   * way the finger goes; with `dragView` the picture follows the finger instead (1:1 when slow).
   */
  moveAim(dx: number, dy: number, t = performance.now()) {
    if (!this.scoped) return;
    const dtm = Math.max(1, t - this.lastMove);
    this.lastMove = t;
    // finger speed, smoothed (single touch events are jittery), starting fresh with each slide
    const inst = Math.hypot(dx, dy) / dtm * 1000; // px/s
    this.dragSpeed = dtm > 120 ? inst : this.dragSpeed * 0.6 + inst * 0.4;
    const accel = 1 + Math.min(2.5, Math.max(0, this.dragSpeed - 250) / 700);
    const gain = this.dragView ? -DRAG_GAIN : AIM_SENSITIVITY;
    const perPx = (THREE.MathUtils.degToRad(this.scopeFov()) / this.scopeD) * gain * this.aimSpeed * accel;
    this.aimYaw += dx * perPx;
    this.aimPitch -= dy * perPx;
    this.clampAim();
    this.placeScope();
  }

  /** Lower the rifle. */
  closeScope() {
    this.scoped = false;
    this.pushHud();
  }
  /** (old name, kept for the pause/hidden/end paths) */
  endAim(_immediate = true) { this.closeScope(); }

  /** The circle sits over the part of the view it's looking at (kept on screen, clear of the buttons). */
  private placeScope() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.aimPitch, -this.aimYaw, 0, "YXZ"));
    const v = this.eye.clone().add(dir).project(this.wideCam);
    const x = ((v.x + 1) / 2) * this.w, y = ((1 - v.y) / 2) * this.h;
    const r = this.scopeD / 2;
    this.scopeCx = Math.min(Math.max(x, r + 6), this.w - r - 118);
    this.scopeCy = Math.min(Math.max(y, r + 56), this.h - r - 4);
  }

  private takeSnapshot() {
    const w = Math.max(2, Math.round(this.w * this.dpr * 0.5)), h = Math.max(2, Math.round(this.h * this.dpr * 0.5));
    if (!this.snapRT || this.snapRT.width !== w || this.snapRT.height !== h) {
      this.snapRT?.dispose();
      this.snapRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      // drawn AFTER the scope, with a round hole where the scope is (so the scope is a clean circle)
      this.snapMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.snapRT.texture }, uCenter: { value: new THREE.Vector2() }, uRadius: { value: 100 }, uDim: { value: 0.34 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: `uniform sampler2D map; uniform vec2 uCenter; uniform float uRadius; uniform float uDim; varying vec2 vUv;
void main() {
  if (distance(gl_FragCoord.xy, uCenter) < uRadius) discard;
  vec3 c = texture2D(map, vUv).rgb;
  c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.6) * uDim;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
        depthTest: false, depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.snapMat);
      quad.frustumCulled = false;
      this.snapScene = new THREE.Scene();
      this.snapScene.add(quad);
    }
    const rd = this.renderer;
    rd.setRenderTarget(this.snapRT);
    rd.clear();
    rd.render(this.scene, this.wideCam);
    rd.setRenderTarget(null);
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
          hitSound(range / 337, range, Math.atan2(hp.x - this.eye.x, -(hp.z - this.eye.z)));
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
          if (range < 450) impactSound(range / 337, range, Math.atan2(p.x - this.eye.x, -(p.z - this.eye.z)));
          // landed short of the buck it was aimed at: that's a low miss
          if (bl.aimed && bl.miss === null) bl.miss = p.distanceTo(this.eye) < bl.aimedDist - 3 ? `low – hit the dirt in front of him. He was ${Math.round(bl.aimedDist / 5) * 5} m away` : "";
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
    const range = Math.round(chest.distanceTo(this.eye) / 5) * 5;
    return `${parts.join(" · ")}${parts.length ? " – " : ""}he was ${range} m away`;
  }

  // ---------- hunt ----------

  startHunt(mode: HuntMode = "classic") {
    this.hunt?.dispose();
    this.rounds = Infinity;
    this.mag = MAG_SIZE;
    this.chamber = "ready";
    this.bullets = [];
    this.endedSent = false;
    this.paused = false;
    this.duskNow = 0;
    this.sky.setLight(0);
    if (this.env) { this.sky.hemi.intensity *= 0.45; this.env.update(0); }
    this.hunt = new Hunt({
      scene: this.scene,
      heightAt: this.terrain.heightAt,
      eye: this.eye,
      bulletsInFlight: () => this.bullets.length,
      setTargets: (t) => { this.targets = t; },
      buckOut: (d) => { this.alerts.push({ deer: d, t: 0 }); alertSound(d.azimuth()); },
    }, this.deerAsset, this.events.banner, this.events.score, this.events.status, mode);
    this.alerts = [];
    this.events.score(0);
    this.pushHud();
  }
  private endedSent = false;
  /** "buck out" markers: a ring where he is, or an arrow on the scope's rim pointing to him */
  private alerts: { deer: Deer; t: number }[] = [];
  private env: { update: (dusk: number) => void } | null = null;
  /** paused: the world keeps drawing but nothing moves (menu open, app in background) */
  paused = false;
  /** how far the sun has gone down (follows the hunt's level, eased) */
  private duskNow = 0;

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
    if (!this.scoped) this.takeSnapshot();
    this.scoped = true;
    this.aimYaw = THREE.MathUtils.degToRad(yawDeg);
    this.aimPitch = THREE.MathUtils.degToRad(pitchDeg);
    this.placeScope();
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

    setListenerYaw(this.scoped ? this.aimYaw : 0);
    this.updateBullets(dt);
    if (this.hunt) {
      // the sun goes down as you climb the levels (eased over ~10 s after each level-up)
      const want = this.hunt.dusk;
      if (Math.abs(want - this.duskNow) > 0.001 && this.frames % 15 === 0) {
        this.duskNow += Math.sign(want - this.duskNow) * Math.min(Math.abs(want - this.duskNow), 0.005);
        this.sky.setLight(this.duskNow);
        if (this.env) { this.sky.hemi.intensity *= 0.45; this.env.update(this.duskNow); }
      }
      this.hunt.update(dt);
      if (this.hunt.over && !this.endedSent) { this.endedSent = true; this.endAim(true); this.events.end(this.hunt.summary()); }
    }
    this.effects.update(dt);
    for (const a of this.alerts) a.t += dt;
    if (this.alerts.length) this.alerts = this.alerts.filter((a) => a.t < ALERT_TIME && a.deer.alive && !a.deer.gone);
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
    const off = (v: { yaw: number; pitch: number }) => Math.max(Math.abs(yaw - v.yaw), Math.abs(pitch - v.pitch));
    const moved = (v: { yaw: number; pitch: number }) => off(v) > fov * 0.18;
    const t = this.vegView, g = this.grassView;
    // a new view (scope up/down, zoom) rebuilds everything now; while sweeping, the trees and the
    // grass take turns (one per frame), so no single frame carries both (the margins cover it)
    const fresh = t.fov !== fovDeg || t.scoped !== this.scoped || g.fov !== fovDeg || g.scoped !== this.scoped;
    const doTrees = fresh || moved(t);
    const doGrass = fresh || (moved(g) && (!doTrees || off(g) > fov * 0.3)); // (never let the grass fall far behind)
    if (!doTrees && !doGrass) return;
    const margin = this.scoped ? 1.45 : 1.1;
    const half = (fov / 2) * margin + 0.002;
    if (doTrees) {
      Object.assign(t, { yaw, pitch, fov: fovDeg, scoped: this.scoped });
      // trees just out of view still cast shadows into it (the sun is low in the south-west)
      const sd = this.sky.sunDir, hl = Math.hypot(sd.x, sd.z) || 1;
      const shadow = { dx: -sd.x / hl, dz: -sd.z / hl, k: hl / Math.max(0.02, sd.y), max: 160 };
      this.forest.update(yaw, half, mag, shadow);
      this.rocks.update(yaw, half, mag);
    }
    if (!doGrass) return;
    Object.assign(g, { yaw, pitch, fov: fovDeg, scoped: this.scoped });
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
    this.grass.update(rMin, rMax, yaw, half, mag);
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
      this.drawAlerts(ctx);
      return;
    }
    const d = this.scopeD, x0 = this.scopeCx - d / 2, y0 = this.scopeCy - d / 2;
    rd.setScissorTest(false);
    rd.setClearColor(0x000000, 1);
    rd.setViewport(0, 0, this.w, this.h);
    rd.clear();
    rd.setScissorTest(true);
    rd.setViewport(x0, this.h - y0 - d, d, d);
    rd.setScissor(x0, this.h - y0 - d, d, d);
    rd.render(this.scene, this.scopeCam);
    rd.setScissorTest(false);
    if (this.snapScene && this.snapMat) {
      const pr = rd.getPixelRatio();
      this.snapMat.uniforms.uCenter.value.set(this.scopeCx * pr, (this.h - this.scopeCy) * pr);
      this.snapMat.uniforms.uRadius.value = (d / 2 - 1) * pr;
      rd.setViewport(0, 0, this.w, this.h);
      rd.render(this.snapScene, this.snapCam);
    }
    const pxPerMil = d / (THREE.MathUtils.degToRad(this.scopeFov()) * 1000);
    const s = this.recoil.shake;
    drawScope(ctx, {
      w: this.w, h: this.h, dpr: this.dpr, cx: this.scopeCx, cy: this.scopeCy, d,
      pxPerMil, zoom: this.zoom,
      jx: (Math.random() - 0.5) * 10 * s, jy: -14 * s + (Math.random() - 0.5) * 6 * s,
    });
    this.drawAlerts(ctx);
  }

  /** "Buck out" markers on the overlay: a pulsing ring on him in the open view; through the scope,
   * an arrow on the rim pointing his way if he isn't in it. */
  private drawAlerts(ctx: CanvasRenderingContext2D) {
    if (!this.alerts.length) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.wideCam.updateMatrixWorld();
    const p = new THREE.Vector3();
    for (const a of this.alerts) {
      const alpha = Math.max(0, Math.min(1, a.t / 0.15, (ALERT_TIME - a.t) / 0.8));
      ctx.strokeStyle = ctx.fillStyle = `rgba(255, 212, 59, ${alpha})`;
      a.deer.chest(p);
      if (this.scoped) {
        const dx = p.x - this.eye.x, dy = p.y - this.eye.y, dz = p.z - this.eye.z;
        const da = Math.atan2(dx, -dz) - this.aimYaw;
        const de = Math.atan2(dy, Math.hypot(dx, dz)) - this.aimPitch;
        if (Math.hypot(da, de) > (THREE.MathUtils.degToRad(this.scopeFov()) / 2) * 0.85) {
          const ang = Math.atan2(-de, da), r = this.scopeD / 2 + 17;
          ctx.save();
          ctx.translate(this.scopeCx + Math.cos(ang) * r, this.scopeCy + Math.sin(ang) * r);
          ctx.rotate(ang);
          ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      // where he is in the open view (not over the scope)
      p.project(this.wideCam);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * this.w, sy = ((1 - p.y) / 2) * this.h;
      if (this.scoped && Math.hypot(sx - this.scopeCx, sy - this.scopeCy) < this.scopeD / 2 + 30) continue;
      const k = (a.t * 1.4) % 1;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255, 212, 59, ${alpha * (1 - k)})`;
      ctx.beginPath(); ctx.arc(sx, sy, 11 + k * 24, 0, Math.PI * 2); ctx.stroke();
    }
  }

  pushHud() {
    this.events.hud({ scoped: this.scoped, zoom: this.zoom, rounds: this.rounds, mag: this.mag, chamber: this.chamber });
  }
}
