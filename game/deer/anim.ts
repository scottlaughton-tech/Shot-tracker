// Procedural animation for the buck. Legs are solved with inverse kinematics in the body's
// side plane (y-z), using how deer legs really work:
//  - front leg: the "knee" (carpus) stays locked straight while the foot is down and folds
//    up in the swing;
//  - hind leg: the stifle and hock are linked (the reciprocal apparatus), so the cannon
//    stays nearly parallel to the thigh bone.
// Gaits: walk (4-beat), trot (diagonal pairs), run (bounding gallop with a flexing spine).
import * as THREE from "three";
import { JOINT_POS } from "./anatomy";
import type { DeerRig } from "./model";
import type { Vec } from "./sdf";

export type HeadMode = "alert" | "feed" | "cruise" | "relaxed";
export type TailMode = "down" | "flag" | "clamped";

export type AnimInput = {
  speed: number;          // m/s along the body's forward axis
  head: HeadMode;
  tail: TailMode;
  lookYaw: number;        // radians, head turned left (+) / right (-)
  hunch: number;          // 0..1 (gut-shot: arched back, head low)
};

type GaitParams = { freq: number; duty: number; off: [number, number, number, number]; lift: number; bob: number; pitch: number; flex: number; kneeFlex: number };
// leg order: LF, RF, LH, RH
const WALK: GaitParams = { freq: 1.35, duty: 0.64, off: [0.25, 0.75, 0.0, 0.5], lift: 0.07, bob: 0.012, pitch: 0.012, flex: 0.0, kneeFlex: 1.2 };
const TROT: GaitParams = { freq: 2.1, duty: 0.42, off: [0.0, 0.5, 0.5, 0.0], lift: 0.13, bob: 0.03, pitch: 0.02, flex: 0.04, kneeFlex: 1.9 };
const RUN: GaitParams = { freq: 2.6, duty: 0.27, off: [0.44, 0.54, 0.0, 0.09], lift: 0.22, bob: 0.1, pitch: 0.16, flex: 0.22, kneeFlex: 2.3 };

function blendGait(speed: number): GaitParams {
  const lerp = (a: GaitParams, b: GaitParams, t: number): GaitParams => ({
    freq: a.freq + (b.freq - a.freq) * t, duty: a.duty + (b.duty - a.duty) * t,
    off: a.off.map((v, i) => v + (b.off[i] - v) * t) as GaitParams["off"],
    lift: a.lift + (b.lift - a.lift) * t, bob: a.bob + (b.bob - a.bob) * t, pitch: a.pitch + (b.pitch - a.pitch) * t,
    flex: a.flex + (b.flex - a.flex) * t, kneeFlex: a.kneeFlex + (b.kneeFlex - a.kneeFlex) * t,
  });
  if (speed < 2.2) return WALK;
  if (speed < 2.8) return lerp(WALK, TROT, (speed - 2.2) / 0.6);
  if (speed < 5.5) return TROT;
  if (speed < 6.5) return lerp(TROT, RUN, (speed - 5.5) / 1.0);
  return RUN;
}

// --- side-plane helpers: angle 0 = pointing straight down, positive = pointing forward ---
const ang = (dy: number, dz: number) => Math.atan2(dz, -dy);
const dirY = (a: number) => -Math.cos(a);
const dirZ = (a: number) => Math.sin(a);
const P = (n: string) => JOINT_POS[n];
const len = (a: string, b: string) => Math.hypot(P(b)[1] - P(a)[1], P(b)[2] - P(a)[2]);
const bindAng = (a: string, b: string) => ang(P(b)[1] - P(a)[1], P(b)[2] - P(a)[2]);
/** rotate (y, z) about x by t */
const rot = (y: number, z: number, t: number): [number, number] => [y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];

type Leg = {
  front: boolean; s: "L" | "R";
  // bones (in chain order)
  b: string[];
  L1: number; L2: number; L3: number;
  a0: number[];   // bind angles of each bone
  foot: Vec;      // neutral fetlock position (root space)
};

function makeLeg(front: boolean, s: "L" | "R"): Leg {
  if (front) {
    const b = [`scap${s}`, `hum${s}`, `rad${s}`, `canF${s}`, `pasF${s}`];
    return {
      front, s, b, L1: len(b[1], b[2]), L2: len(b[2], b[3]), L3: len(b[3], b[4]),
      a0: [bindAng(b[0], b[1]), bindAng(b[1], b[2]), bindAng(b[2], b[3]), bindAng(b[3], b[4]), bindAng(b[4], `toeF${s}`)],
      foot: P(b[4]),
    };
  }
  const b = [`fem${s}`, `tib${s}`, `met${s}`, `pasH${s}`];
  return {
    front, s, b, L1: len(b[0], b[1]), L2: len(b[1], b[2]), L3: len(b[2], b[3]),
    a0: [bindAng(b[0], b[1]), bindAng(b[1], b[2]), bindAng(b[2], b[3]), bindAng(b[3], `toeH${s}`)],
    foot: P(b[3]),
  };
}

const LEGS = [makeLeg(true, "L"), makeLeg(true, "R"), makeLeg(false, "L"), makeLeg(false, "R")];

export class DeerAnimator {
  phase = 0;
  private headPose = { n1: 0, n2: 0, h: 0 };
  private tailAng = 0;
  private lookYaw = 0;
  private earT = 0;
  private earFlick = 0;
  private speedS = 0;
  /** extra pose layers driven by reactions (0..1) */
  kick = 0;
  death = 0;
  deathSide = 1;
  private t = 0;

  constructor(private rig: DeerRig) {}

  update(dt: number, inp: AnimInput) {
    this.t += dt;
    const B = this.rig.bones;
    this.speedS += (inp.speed - this.speedS) * Math.min(1, dt * 4);
    const speed = this.speedS;
    const g = blendGait(speed);
    this.phase = (this.phase + dt * g.freq * Math.min(1, 0.25 + speed / 0.8)) % 1;
    const moving = Math.min(1, speed / 0.6);

    // ---- body: bob, pitch, spine flex ----
    const ph2 = this.phase * Math.PI * 2;
    const bob = -g.bob * moving * (g === RUN ? Math.sin(ph2 + 0.6) : Math.cos(ph2 * 2));
    const pitch = g.pitch * moving * Math.sin(ph2 + (g === RUN ? 0.9 : 0));
    const flex = g.flex * moving * Math.sin(ph2 + 0.3) + inp.hunch * 0.12;
    B.pelvis.position.set(0, P("pelvis")[1] + bob - inp.hunch * 0.03, P("pelvis")[2]);
    const tP = pitch * 0.6 - flex * 0.5;
    const tS1 = flex * 0.45, tS2 = flex * 0.35, tC = -flex * 0.2;
    B.pelvis.rotation.set(tP, 0, 0);
    B.spine1.rotation.set(tS1, 0, 0);
    B.spine2.rotation.set(tS2, 0, 0);
    B.chest.rotation.set(tC, 0, 0);
    const thChest = tP + tS1 + tS2 + tC;

    // root-space positions of hips and shoulders via side-plane FK
    const fk = (chain: string[], thetas: number[], base: [number, number]) => {
      let y = base[0], z = base[1];
      for (let i = 1; i < chain.length; i++) {
        const dy = P(chain[i])[1] - P(chain[i - 1])[1], dz = P(chain[i])[2] - P(chain[i - 1])[2];
        const [ry, rz] = rot(dy, dz, thetas[i - 1]);
        y += ry; z += rz;
      }
      return [y, z] as [number, number];
    };
    const pelvisYZ: [number, number] = [P("pelvis")[1] + bob - inp.hunch * 0.03, P("pelvis")[2]];
    const chestYZ = fk(["pelvis", "spine1", "spine2", "chest"], [tP, tP + tS1, tP + tS1 + tS2], pelvisYZ);

    // ---- legs ----
    const stanceLen = Math.min(1.25, (speed * g.duty) / g.freq);
    for (let i = 0; i < 4; i++) {
      const leg = LEGS[i];
      const lp = (this.phase + g.off[i]) % 1;
      let dz: number, lift: number, swingS = 0;
      if (lp < g.duty) {
        const s = lp / g.duty;
        dz = stanceLen * (0.5 - s);
        lift = 0;
      } else {
        swingS = (lp - g.duty) / (1 - g.duty);
        const e = swingS * swingS * (3 - 2 * swingS);
        dz = stanceLen * (e - 0.5);
        lift = g.lift * Math.sin(Math.PI * swingS) * moving;
      }
      let ty = leg.foot[1] + lift, tz = leg.foot[2] + dz + (leg.front ? 0.04 : -0.02) * moving;
      if (!leg.front && this.kick > 0) {
        // mule kick: both hind feet fly back and up
        const k = Math.sin(Math.min(1, this.kick) * Math.PI);
        ty += 0.45 * k; tz -= 0.5 * k;
      }
      if (leg.front) this.solveFront(leg, chestYZ, thChest, ty, tz, swingS > 0 ? Math.sin(Math.PI * swingS) * g.kneeFlex * moving : 0, swingS);
      else this.solveHind(leg, pelvisYZ, tP, ty, tz, swingS);
    }

    // ---- neck & head ----
    const target = inp.head === "feed" ? { n1: 1.05, n2: 0.35, h: 0.45 }
      : inp.head === "alert" ? { n1: -0.22, n2: -0.05, h: 0.12 }
      : inp.head === "cruise" ? { n1: 0.42, n2: 0.18, h: -0.12 }
      : { n1: 0.12, n2: 0.05, h: 0.05 };
    // running: neck stretched forward, head level
    const run = Math.min(1, Math.max(0, (speed - 5) / 3));
    target.n1 = target.n1 * (1 - run) + 0.55 * run + inp.hunch * 0.4;
    target.n2 = target.n2 * (1 - run) + 0.2 * run;
    target.h = target.h * (1 - run) - 0.35 * run;
    const k = Math.min(1, dt * (inp.head === "alert" ? 6 : 2.5));
    this.headPose.n1 += (target.n1 - this.headPose.n1) * k;
    this.headPose.n2 += (target.n2 - this.headPose.n2) * k;
    this.headPose.h += (target.h - this.headPose.h) * k;
    this.lookYaw += (inp.lookYaw - this.lookYaw) * Math.min(1, dt * 5);
    // walking deer nod with each front step
    const nod = 0.05 * moving * (1 - run) * Math.sin(ph2 * 2 + 1.2);
    B.neck1.rotation.set(this.headPose.n1 - thChest * 0.7 + nod, this.lookYaw * 0.45, 0, "YXZ");
    B.neck2.rotation.set(this.headPose.n2 + nod * 0.5, this.lookYaw * 0.3, 0, "YXZ");
    // keep the head roughly level whatever the neck does
    B.head.rotation.set(this.headPose.h - (this.headPose.n1 + this.headPose.n2) * 0.55, this.lookYaw * 0.25, 0, "YXZ");

    // ---- tail ----
    const tailTarget = inp.tail === "flag" ? 2.2 : inp.tail === "clamped" ? -0.25 : 0.05 * Math.sin(this.t * 1.3);
    this.tailAng += (tailTarget - this.tailAng) * Math.min(1, dt * (inp.tail === "flag" ? 9 : 3));
    const swish = inp.tail === "flag" ? 0.15 * Math.sin(this.t * 9) : inp.tail === "down" ? 0.12 * Math.sin(this.t * 2.1) * (Math.sin(this.t * 0.37) > 0.6 ? 1 : 0) : 0;
    B.tail.rotation.set(this.tailAng, swish, 0, "YXZ");

    // ---- ears: forward when alert, occasional flick ----
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1.5 + Math.random() * 4; this.earFlick = 1; }
    this.earFlick = Math.max(0, this.earFlick - dt * 6);
    const fwd = inp.head === "alert" ? 0.45 : run > 0.5 ? -0.5 : 0.1;
    const fl = Math.sin(this.earFlick * Math.PI) * 0.5;
    B.earL.rotation.set(-0.1, fwd + fl, 0);
    B.earR.rotation.set(-0.1, -fwd, 0);

    if (this.death > 0) this.applyDeath();
  }

  private solveFront(leg: Leg, chest: [number, number], thChest: number, ty: number, tz: number, kappa: number, swing: number) {
    const B = this.rig.bones;
    const [scap, hum, rad, can, pas] = leg.b;
    // shoulder blade swings a little with the upper arm
    const scapLocal = 0.0;
    const thScap = thChest + scapLocal;
    const sOff = rot(P(scap)[1] - P("chest")[1], P(scap)[2] - P("chest")[2], thChest);
    const hOff = rot(P(hum)[1] - P(scap)[1], P(hum)[2] - P(scap)[2], thScap);
    const Sy = chest[0] + sOff[0] + hOff[0], Sz = chest[1] + sOff[1] + hOff[1];
    const { L1, L2, L3 } = leg;
    const L23 = Math.sqrt(L2 * L2 + L3 * L3 + 2 * L2 * L3 * Math.cos(kappa));
    const delta = Math.asin(Math.min(1, (L3 * Math.sin(kappa)) / L23));
    let dy = ty - Sy, dz = tz - Sz;
    let d = Math.hypot(dy, dz);
    const dMax = L1 + L23 - 0.002, dMin = Math.abs(L1 - L23) + 0.01;
    if (d > dMax) { dy *= dMax / d; dz *= dMax / d; d = dMax; }
    if (d < dMin) d = dMin;
    const aD = ang(dy, dz);
    const alpha = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L23 * L23) / (2 * L1 * d))));
    const aH = aD - alpha;
    const Ey = Sy + L1 * dirY(aH), Ez = Sz + L1 * dirZ(aH);
    const aET = ang(Sy + dy - Ey, Sz + dz - Ez);
    const aF = aET + delta;
    const aC = aF - kappa;
    // pastern: flat on the ground in stance, folds back in the swing
    const aP = swing > 0 ? aC - 1.4 * Math.sin(Math.PI * swing) : leg.a0[4];
    const th = [thScap, leg.a0[1] - aH, leg.a0[2] - aF, leg.a0[3] - aC, leg.a0[4] - aP];
    B[scap].rotation.set(scapLocal, 0, 0);
    B[hum].rotation.set(th[1] - th[0], 0, 0);
    B[rad].rotation.set(th[2] - th[1], 0, 0);
    B[can].rotation.set(th[3] - th[2], 0, 0);
    B[pas].rotation.set(th[4] - th[3], 0, 0);
  }

  private solveHind(leg: Leg, pelvis: [number, number], thP: number, ty: number, tz: number, swing: number) {
    const B = this.rig.bones;
    const [fem, tib, met, pas] = leg.b;
    const hOff = rot(P(fem)[1] - P("pelvis")[1], P(fem)[2] - P("pelvis")[2], thP);
    const Hy = pelvis[0] + hOff[0], Hz = pelvis[1] + hOff[1];
    const { L1, L2, L3 } = leg;
    const Delta = leg.a0[2] - leg.a0[0];
    const A = Math.sqrt(L1 * L1 + L3 * L3 + 2 * L1 * L3 * Math.cos(Delta));
    const gamma = Math.atan2(L3 * Math.sin(Delta), L1 + L3 * Math.cos(Delta));
    let dy = ty - Hy, dz = tz - Hz;
    let d = Math.hypot(dy, dz);
    const dMax = A + L2 - 0.002, dMin = Math.abs(A - L2) + 0.01;
    if (d > dMax) { dy *= dMax / d; dz *= dMax / d; d = dMax; }
    if (d < dMin) d = dMin;
    const aD = ang(dy, dz);
    const alpha = Math.acos(Math.min(1, Math.max(-1, (A * A + d * d - L2 * L2) / (2 * A * d))));
    const a1 = aD + alpha - gamma;
    const Ky = Hy + L1 * dirY(a1), Kz = Hz + L1 * dirZ(a1);
    const a3 = a1 + Delta;
    const hockY = Hy + dy - L3 * dirY(a3), hockZ = Hz + dz - L3 * dirZ(a3);
    const a2 = ang(hockY - Ky, hockZ - Kz);
    const aP = swing > 0 ? a3 - 1.2 * Math.sin(Math.PI * swing) : leg.a0[3];
    const th = [leg.a0[0] - a1, leg.a0[1] - a2, leg.a0[2] - a3, leg.a0[3] - aP];
    B[fem].rotation.set(th[0] - thP, 0, 0);
    B[tib].rotation.set(th[1] - th[0], 0, 0);
    B[met].rotation.set(th[2] - th[1], 0, 0);
    B[pas].rotation.set(th[3] - th[2], 0, 0);
  }

  /** Down on its side: legs go limp, neck drops, body rolls over (blended by this.death). */
  private applyDeath() {
    const B = this.rig.bones;
    const t = Math.min(1, this.death);
    const e = t * t * (3 - 2 * t);
    const side = this.deathSide;
    const lie = B.root;
    lie.rotation.set(0, 0, side * 1.45 * e);
    lie.position.set(0, 0.07 * e, 0);
    // legs relax, slightly bent, sticking out
    for (const s of ["L", "R"]) {
      B[`hum${s}`].rotation.x = B[`hum${s}`].rotation.x * (1 - e) + 0.25 * e;
      B[`rad${s}`].rotation.x = B[`rad${s}`].rotation.x * (1 - e) - 0.35 * e;
      B[`canF${s}`].rotation.x = B[`canF${s}`].rotation.x * (1 - e) + 0.2 * e;
      B[`fem${s}`].rotation.x = B[`fem${s}`].rotation.x * (1 - e) - 0.3 * e;
      B[`tib${s}`].rotation.x = B[`tib${s}`].rotation.x * (1 - e) + 0.25 * e;
      B[`met${s}`].rotation.x = B[`met${s}`].rotation.x * (1 - e) - 0.1 * e;
    }
    B.neck1.rotation.x = B.neck1.rotation.x * (1 - e) + 0.75 * e;
    B.neck1.rotation.y = B.neck1.rotation.y * (1 - e) - side * 0.5 * e;
    B.neck2.rotation.x = B.neck2.rotation.x * (1 - e) + 0.3 * e;
    B.head.rotation.x = B.head.rotation.x * (1 - e) + 0.2 * e;
    B.tail.rotation.x = B.tail.rotation.x * (1 - e);
  }
}

export const _test = { blendGait, LEGS };
export const ZERO = new THREE.Vector3();
