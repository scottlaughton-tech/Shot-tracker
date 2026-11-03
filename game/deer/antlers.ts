// Whitetail antlers: a main beam that sweeps out and forward, with tines rising straight up
// off it. Built per buck from a point count (spike, fork, 6, 8, 10, 12 points).
import * as THREE from "three";
import { JOINT_POS } from "./anatomy";
import { mulberry32 } from "../world/noise";

export type Rack = { points: number; left: number; right: number; size: number };

/** Random rack: mostly 6s and 8s, some 10s, the odd spike/fork or 12. */
export function randomRack(rnd: () => number): Rack {
  const r = rnd();
  const perSide = r < 0.05 ? 1 : r < 0.15 ? 2 : r < 0.4 ? 3 : r < 0.8 ? 4 : r < 0.95 ? 5 : 6;
  let left = perSide, right = perSide;
  if (perSide > 2 && rnd() < 0.2) right = Math.max(2, perSide - 1); // a little uneven sometimes
  const size = perSide === 1 ? 0.45 : perSide === 2 ? 0.65 : 0.78 + 0.07 * (perSide - 3) + rnd() * 0.12;
  return { points: left + right, left, right, size };
}

type Builder = { pos: number[]; nor: number[]; col: number[]; idx: number[] };

function tube(b: Builder, curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs: number, sides: number, c0: THREE.Color, c1: THREE.Color, rnd: () => number) {
  const frames = curve.computeFrenetFrames(segs, false);
  const base = b.pos.length / 3;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    // taper, with a bumpy "pearled" base
    const r = (r0 + (r1 - r0) * Math.pow(t, 0.8)) * (1 + (t < 0.3 ? 0.08 * (rnd() - 0.5) : 0));
    c.copy(c0).lerp(c1, Math.pow(t, 2.2));
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      b.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      b.nor.push(n.x, n.y, n.z);
      b.col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * (sides + 1) + s, bb = a + 1, cc = a + sides + 1, d = cc + 1;
    b.idx.push(a, cc, bb, bb, cc, d);
  }
}

const BASE_COL = new THREE.Color().setRGB(0.3, 0.23, 0.16, THREE.SRGBColorSpace);
const MID_COL = new THREE.Color().setRGB(0.52, 0.43, 0.32, THREE.SRGBColorSpace);
const TIP_COL = new THREE.Color().setRGB(0.86, 0.82, 0.72, THREE.SRGBColorSpace);

export type AntlerResult = { geometry: THREE.BufferGeometry; tips: THREE.Vector3[]; segments: [THREE.Vector3, THREE.Vector3, number][] };

/** Geometry in the head bone's local space. `segments` are capsules for bullet hit tests. */
export function buildAntlers(rack: Rack, seed: number): AntlerResult {
  const rnd = mulberry32(seed);
  const b: Builder = { pos: [], nor: [], col: [], idx: [] };
  const hp = JOINT_POS.head;
  const tips: THREE.Vector3[] = [];
  const segments: [THREE.Vector3, THREE.Vector3, number][] = [];
  const S = rack.size;
  for (const side of [1, -1]) {
    const count = side === 1 ? rack.left : rack.right;
    const sx = (v: number) => v * side;
    const base = new THREE.Vector3(sx(0.034), 1.452 - hp[1], 0.792 - hp[2]);
    // burr
    tube(b, new THREE.LineCurve3(base.clone().add(new THREE.Vector3(0, -0.008, 0)), base.clone().add(new THREE.Vector3(sx(0.004), 0.012, -0.002))), 0.03 * Math.max(0.7, S), 0.028 * Math.max(0.7, S), 1, 10, BASE_COL, BASE_COL, rnd);
    let beam: THREE.CatmullRomCurve3;
    if (count === 1) {
      beam = new THREE.CatmullRomCurve3([base, base.clone().add(new THREE.Vector3(sx(0.02), 0.09, 0.005)), base.clone().add(new THREE.Vector3(sx(0.03), 0.16 * S + 0.05, 0.03))]);
    } else {
      const j = () => (rnd() - 0.5) * 0.02;
      beam = new THREE.CatmullRomCurve3([
        base,
        base.clone().add(new THREE.Vector3(sx(0.06 * S + j()), 0.09 * S, -0.06 * S)),
        base.clone().add(new THREE.Vector3(sx(0.17 * S + j()), 0.14 * S, -0.02 * S)),
        base.clone().add(new THREE.Vector3(sx(0.2 * S + j()), 0.155 * S, 0.11 * S)),
        base.clone().add(new THREE.Vector3(sx(0.12 * S + j()), 0.15 * S + j(), 0.23 * S)),
      ], false, "catmullrom", 0.5);
    }
    const r0 = 0.021 * Math.max(0.6, S), r1 = 0.006;
    tube(b, beam, r0, r1, 24, 8, BASE_COL, TIP_COL, rnd);
    tips.push(beam.getPointAt(1));
    for (let k = 0; k < 6; k++) {
      const a = beam.getPointAt(k / 5), c = beam.getPointAt(Math.min(1, (k + 1) / 5));
      segments.push([a, c, r0 * (1 - k / 6) + 0.004]);
    }
    // tines: brow tine near the base, then the tall back tines
    const tineAt = [0.1, 0.36, 0.56, 0.76, 0.88];
    const tineLen = [0.075, 0.22, 0.19, 0.11, 0.07];
    for (let t = 0; t < count - 1; t++) {
      const at = tineAt[t];
      const p0 = beam.getPointAt(at);
      const tan = beam.getTangentAt(at);
      const len = tineLen[t] * S * (0.85 + rnd() * 0.3) * (count === 2 ? 0.8 : 1);
      // straight up, leaning slightly inward and following the beam forward
      const dir = new THREE.Vector3(sx(-0.08), 1, 0).addScaledVector(tan, 0.18 + (t === 0 ? 0.25 : 0)).normalize();
      const mid = p0.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(sx(0.01) * (rnd() - 0.5), 0, 0.01 * (rnd() - 0.3)));
      const end = p0.clone().addScaledVector(dir, len).add(new THREE.Vector3(sx(-0.012), 0, 0.015));
      const curve = new THREE.CatmullRomCurve3([p0.clone().addScaledVector(dir, -0.004), mid, end]);
      const rt = r0 * (0.62 - t * 0.06);
      tube(b, curve, rt, 0.004, 10, 6, MID_COL, TIP_COL, rnd);
      tips.push(end);
      segments.push([p0, mid, rt], [mid, end, rt * 0.6]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return { geometry: g, tips, segments };
}

export const antlerMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
