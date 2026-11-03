// One buck in the field: where it's going, how it reacts to shots, and what a bullet hits.
import * as THREE from "three";
import { BODY, ORGANS, TAG_ZONE } from "./anatomy";
import { DeerAnimator, type HeadMode, type TailMode } from "./anim";
import { antlerMaterial, buildAntlers, type Rack } from "./antlers";
import { makeRig, type DeerAsset, type DeerRig } from "./model";
import { nearestCover, type P2 } from "./routes";
import { primDist, type Prim } from "./sdf";
import { primaryZone, ZONES, type Gait, type Outcome, type Zone } from "../scoring";
import { SPEED_OF_SOUND } from "../ballistics";
import { snortSound } from "../engine/audio";

export type DeerState = "travel" | "feed" | "look" | "alert" | "flee" | "kick" | "wounded" | "dying" | "dead" | "gone";

export type HitInfo = { zones: Zone[]; primary: Zone; outcome: Outcome; range: number; gait: Gait; point: THREE.Vector3 };

export type DeerEvents = {
  hit: (d: Deer, info: HitInfo) => void;
  down: (d: Deer) => void;
  escaped: (d: Deer, wounded: boolean) => void;
};

type World = { heightAt: (x: number, z: number) => number; eye: THREE.Vector3 };

const _m = new THREE.Matrix4();

export class Deer {
  readonly rig: DeerRig;
  readonly anim: DeerAnimator;
  state: DeerState = "travel";
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  travelSpeed: number;
  wounded = false;
  lethal: Outcome | null = null;
  hits = 0;
  private route: P2[];
  private wp = 1;
  private timer = 0;
  private nextStop: number;
  private runLeft = 0;
  private head: HeadMode = "cruise";
  private tail: TailMode = "down";
  private look = 0;
  private boneIndex: Map<string, number>;
  private antlerSegs: [THREE.Vector3, THREE.Vector3, number][];
  private pendingSounds: { at: number; fn: () => void }[] = [];
  private clock = 0;

  constructor(readonly id: number, asset: DeerAsset, readonly rack: Rack, route: P2[], private world: World, private events: DeerEvents, rnd: () => number) {
    this.rig = makeRig(asset);
    const ant = buildAntlers(rack, 1000 + id * 17);
    const antlers = new THREE.Mesh(ant.geometry, antlerMaterial());
    antlers.castShadow = true;
    this.rig.bones.head.add(antlers);
    this.antlerSegs = ant.segments;
    this.anim = new DeerAnimator(this.rig);
    this.boneIndex = new Map(asset.boneNames.map((n, i) => [n, i]));
    this.route = route;
    this.pos.set(route[0].x, world.heightAt(route[0].x, route[0].z), route[0].z);
    this.heading = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
    const g = rnd();
    this.travelSpeed = g < 0.68 ? 1.2 + rnd() * 0.5 : g < 0.9 ? 3.0 + rnd() * 1.0 : 8.5 + rnd() * 3;
    this.head = this.travelSpeed < 2 ? (rnd() < 0.5 ? "cruise" : "relaxed") : "relaxed";
    this.nextStop = 6 + rnd() * 14;
    if (this.travelSpeed > 7) { this.tail = "flag"; this.nextStop = 1e9; }
    this.sync(0);
  }

  get gait(): Gait {
    const s = this.speed;
    return s < 0.3 ? "stand" : s < 2.4 ? "walk" : s < 6 ? "trot" : "run";
  }
  get alive() { return this.state !== "dying" && this.state !== "dead"; }
  get gone() { return this.state === "gone"; }
  /** chest centre in world space (for "missed high/low" feedback) */
  chest(out = new THREE.Vector3()) { return this.rig.bones.spine2.getWorldPosition(out).add(new THREE.Vector3(0, -0.15, 0)); }

  // ---------- reactions ----------

  /** A shot was fired from the stand; the sound arrives after distance/speed of sound. */
  hearShot(impact: THREE.Vector3 | null) {
    if (!this.alive || this.state === "gone") return;
    const dist = this.pos.distanceTo(this.world.eye);
    const delay = dist / SPEED_OF_SOUND;
    const near = impact && impact.distanceTo(this.pos) < 25;
    this.pendingSounds.push({ at: this.clock + delay, fn: () => {
      if (!this.alive || this.state === "wounded" || this.state === "flee" || this.state === "kick") return;
      if (near || dist < 230 || Math.random() < 0.3) this.flee();
      else { this.state = "alert"; this.timer = 2 + Math.random() * 3; }
    } });
  }

  private flee(tail: TailMode = "flag") {
    const dist = this.pos.distanceTo(this.world.eye);
    if (!this.wounded && !this.lethal && this.state !== "flee" && dist < 220 && Math.random() < 0.6) snortSound(dist / SPEED_OF_SOUND + 0.2, dist);
    const ax = this.pos.x - this.world.eye.x, az = this.pos.z - this.world.eye.z;
    const al = Math.hypot(ax, az) || 1;
    this.route = [{ x: this.pos.x, z: this.pos.z }, ...nearestCover(this.pos.x, this.pos.z, ax / al, az / al)];
    this.wp = 1;
    this.state = this.wounded ? "wounded" : "flee";
    this.tail = tail;
  }

  // ---------- movement ----------

  update(dt: number) {
    this.clock += dt;
    for (let i = this.pendingSounds.length - 1; i >= 0; i--) if (this.pendingSounds[i].at <= this.clock) { this.pendingSounds[i].fn(); this.pendingSounds.splice(i, 1); }
    let target = 0;
    let lookYaw = 0;
    switch (this.state) {
      case "travel":
        target = this.travelSpeed;
        this.nextStop -= dt;
        if (this.nextStop <= 0 && this.wp > 2 && this.wp < this.route.length - 1) {
          const r = Math.random();
          this.state = r < 0.55 ? "feed" : "look";
          this.timer = this.state === "feed" ? 5 + Math.random() * 9 : 2 + Math.random() * 3;
          this.nextStop = 8 + Math.random() * 16;
        }
        break;
      case "feed": target = 0; this.head = "feed"; this.timer -= dt; if (this.timer <= 0) { this.state = "travel"; this.head = "cruise"; } break;
      case "look": target = 0; this.head = "alert"; lookYaw = this.lookToward(); this.timer -= dt; if (this.timer <= 0) { this.state = "travel"; this.head = "relaxed"; } break;
      case "alert":
        target = 0; this.head = "alert"; lookYaw = this.lookToward(); this.timer -= dt;
        if (this.timer <= 0) { this.state = "travel"; this.travelSpeed = Math.max(this.travelSpeed, Math.random() < 0.5 ? 3.4 : 1.5); this.head = "relaxed"; }
        break;
      case "flee": target = 10.5; this.head = "relaxed"; break;
      case "wounded": target = 7.5; this.head = "relaxed"; this.tail = "clamped"; break;
      case "kick":
        target = 0.5; this.timer -= dt;
        this.anim.kick = 1 - this.timer / 0.4;
        if (this.timer <= 0) { this.anim.kick = 0; this.state = "flee"; this.tail = "clamped"; }
        break;
      case "dying":
        target = 0;
        this.anim.death = Math.min(1, this.anim.death + dt * 1.4);
        if (this.anim.death >= 1) { this.state = "dead"; this.events.down(this); }
        break;
      case "dead": case "gone": target = 0; break;
    }
    // a lethally hit buck runs its last stretch, then goes down
    if (this.lethal && (this.state === "flee" || this.state === "wounded")) {
      const step = this.speed * dt;
      this.runLeft -= step;
      if (this.runLeft < 12) target = Math.max(1.5, target * (this.runLeft / 12));
      if (this.runLeft <= 0) { this.state = "dying"; this.anim.deathSide = Math.random() < 0.5 ? 1 : -1; }
    }
    const accel = target > this.speed ? (this.state === "flee" || this.state === "wounded" ? 9 : 2.2) : 4;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), accel * dt);

    // steer along the route
    if (this.state !== "dying" && this.state !== "dead" && this.state !== "gone" && this.speed > 0.05) {
      const w = this.route[this.wp];
      if (w) {
        const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
        const want = Math.atan2(dx, dz);
        let d = want - this.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const rate = this.speed > 6 ? 1.6 : 1.1;
        this.heading += Math.max(-rate * dt, Math.min(rate * dt, d));
        if (Math.hypot(dx, dz) < Math.max(3, this.speed * 0.6)) {
          this.wp++;
          if (this.wp >= this.route.length) this.leave();
        }
      }
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
    }
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.anim.update(dt, { speed: this.speed, head: this.head, tail: this.tail, lookYaw, hunch: this.wounded && !this.lethal ? 0.6 : 0 });
    this.sync(dt);
  }

  private leave() {
    if (this.lethal) { this.state = "dying"; return; }
    this.state = "gone";
    this.events.escaped(this, this.wounded);
  }

  /** Head turn needed to look at the stand. */
  private lookToward(): number {
    const want = Math.atan2(this.world.eye.x - this.pos.x, this.world.eye.z - this.pos.z);
    let d = want - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.max(-1.3, Math.min(1.3, d));
  }

  private sync(_dt: number) {
    const r = this.rig.root;
    r.position.copy(this.pos);
    // pitch with the slope under the body
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hf = this.world.heightAt(this.pos.x + fx * 0.4, this.pos.z + fz * 0.4);
    const hb = this.world.heightAt(this.pos.x - fx * 0.4, this.pos.z - fz * 0.4);
    r.rotation.set(-Math.atan2(hf - hb, 0.8), this.heading, 0, "YXZ");
    r.updateMatrixWorld(true);
  }

  // ---------- bullets ----------

  hitTest(a: THREE.Vector3, b: THREE.Vector3, vel: THREE.Vector3): { t: number; onHit: () => void } | null {
    if (this.state === "gone") return null;
    const c = this.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    // quick reject: segment far from the deer
    const ab = b.clone().sub(a);
    const t0 = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / ab.lengthSq()));
    if (a.clone().addScaledVector(ab, t0).distanceTo(c) > 1.7) return null;

    const sk = this.rig.mesh.skeleton;
    const inv = new Map<string, THREE.Matrix4>();
    const toBind = (bone: string) => {
      let m = inv.get(bone);
      if (!m) {
        const i = this.boneIndex.get(bone)!;
        m = new THREE.Matrix4().multiplyMatrices(sk.bones[i].matrixWorld, sk.boneInverses[i]).invert();
        inv.set(bone, m);
      }
      return m;
    };
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    const inside = (prim: Prim, w: THREE.Vector3) => { q.copy(w).applyMatrix4(toBind(prim.bone)); return primDist(prim, q.x, q.y, q.z) - prim.k * 0.15; };
    const len = ab.length();
    const step = 0.01;
    let entry = -1, entryTag = "";
    for (let s = 0; s <= len; s += step) {
      p.copy(a).addScaledVector(ab, s / len);
      for (const prim of BODY) if (inside(prim, p) < 0) { entry = s; entryTag = prim.tag; break; }
      if (entry >= 0) break;
      // antlers
      for (const [s0, s1, r] of this.antlerSegs) {
        q.copy(p).applyMatrix4(this.rig.bones.head.matrixWorld.clone().invert());
        if (distToSeg(q, s0, s1) < r + 0.005) { entry = s; entryTag = "antler"; break; }
      }
      if (entry >= 0) break;
    }
    if (entry < 0) return null;
    const hitPoint = a.clone().addScaledVector(ab, entry / len);
    const dir = vel.clone().normalize();
    // follow the bullet through the body (it exits on a deer-sized animal)
    const zones = new Set<Zone>();
    zones.add(TAG_ZONE[entryTag] ?? "paunch");
    if (entryTag !== "antler") {
      for (let s = 0; s < 1.3; s += 0.01) {
        p.copy(hitPoint).addScaledVector(dir, s);
        for (const o of ORGANS) if (inside(o.prim, p) < 0) zones.add(o.zone);
        // limbs and neck it passes through on the way (e.g. through the far shoulder)
        if (s > 0.02) for (const prim of BODY) if ((prim.tag === "shoulder" || prim.tag === "leg") && inside(prim, p) < 0) zones.add(TAG_ZONE[prim.tag]);
      }
    }
    const list = [...zones];
    const primary = primaryZone(list)!;
    return {
      t: entry / len,
      onHit: () => this.takeHit(list, primary, hitPoint),
    };
  }

  private takeHit(zones: Zone[], primary: Zone, point: THREE.Vector3) {
    if (!this.alive) return;
    this.hits++;
    const outcome = ZONES[primary].outcome;
    const info: HitInfo = { zones, primary, outcome, range: point.distanceTo(this.world.eye), gait: this.gait, point };
    this.events.hit(this, info);
    if (outcome === "none") { this.flee(); return; }
    if (outcome === "wound") {
      this.wounded = true;
      this.flee("clamped");
      this.state = "wounded";
      return;
    }
    this.lethal = outcome;
    if (outcome === "drop") { this.state = "dying"; this.anim.deathSide = Math.random() < 0.5 ? 1 : -1; this.anim.death = 0.15; return; }
    this.runLeft = outcome === "short" ? 25 + Math.random() * 35 : outcome === "run" ? 40 + Math.random() * 60 : 80 + Math.random() * 70;
    this.flee(outcome === "short" ? "clamped" : "flag");
    if (outcome === "short") { this.state = "kick"; this.timer = 0.4; }
  }
}

function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
