// Procedural tree and shrub models: bark as tapered tubes, foliage as textured cards
// (needle sprays, twig clusters, leaf clusters) from the foliage atlas.
// Each model is two geometries in the tree's local space (base at the origin, +y up).
import * as THREE from "three";
import { Card, cellUV } from "./foliageTextures";
import { mulberry32 } from "./noise";

export type BarkKind = "maple" | "birch" | "pine" | "spruce" | "oak";
export type Species = "spruce" | "fir" | "whitepine" | "cedar" | "tamarack" | "maple" | "birch" | "oak" | "beech"
  | "dogwood" | "alder" | "sapling" | "sumac" | "juniper";

export type TreeModel = {
  species: Species;
  bark: BarkKind;
  barkGeo: THREE.BufferGeometry;
  leafGeo: THREE.BufferGeometry;
  height: number;
  radius: number;
};

type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

class Builder {
  // bark
  bp: number[] = []; bn: number[] = []; bu: number[] = []; bi: number[] = [];
  // foliage cards
  lp: number[] = []; ln: number[] = []; lu: number[] = []; li: number[] = []; lc: number[] = []; lw: number[] = [];

  /** Tapered tube along points with radii. */
  tube(pts: V3[], radii: number[], sides: number, uScale = 1) {
    const base = this.bp.length / 3;
    let along = 0;
    const tan = v(), nrm = v(), bin = v(), prevN = v(1, 0, 0);
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      tan.subVectors(b, a).normalize();
      // parallel transport the frame so the tube doesn't twist
      nrm.copy(prevN).addScaledVector(tan, -prevN.dot(tan));
      if (nrm.lengthSq() < 1e-6) nrm.set(tan.y, -tan.x, 0);
      nrm.normalize();
      prevN.copy(nrm);
      bin.crossVectors(tan, nrm);
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const cx = Math.cos(ang), sx = Math.sin(ang);
        const dx = nrm.x * cx + bin.x * sx, dy = nrm.y * cx + bin.y * sx, dz = nrm.z * cx + bin.z * sx;
        this.bp.push(pts[i].x + dx * radii[i], pts[i].y + dy * radii[i], pts[i].z + dz * radii[i]);
        this.bn.push(dx, dy, dz);
        this.bu.push((s / sides) * uScale, (along / (Math.PI * 2 * Math.max(0.05, radii[0]))) * uScale);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
        this.bi.push(a, b, c, b, d, c);
      }
    }
  }

  /**
   * A foliage card: quad from `root` extending along `dir` (length) and `side` (half width each way).
   * `normal` is the shading normal (pointing out of the crown), `ao` darkens inner cards,
   * `sway` (0..1) scales the wind movement.
   */
  card(card: Card, root: V3, dir: V3, side: V3, length: number, width: number, normal: V3, ao: number, sway: number, flipU = false) {
    const [u0, v0, u1, v1] = cellUV(card);
    const base = this.lp.length / 3;
    const w = side.clone().multiplyScalar(width / 2);
    const tip = root.clone().addScaledVector(dir, length);
    // the texture's left edge (u0) is attached at the root, its right edge (u1) is the tip
    const corners = [root.clone().sub(w), root.clone().add(w), tip.clone().add(w), tip.clone().sub(w)];
    const uv = flipU ? [[u0, v1], [u0, v0], [u1, v0], [u1, v1]] : [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
    const swayK = [0.15, 0.15, 1, 1];
    for (let k = 0; k < 4; k++) {
      const p = corners[k];
      this.lp.push(p.x, p.y, p.z);
      this.ln.push(normal.x, normal.y, normal.z);
      this.lu.push(uv[k][0], uv[k][1]);
      this.lc.push(ao, ao, ao);
      this.lw.push(sway * swayK[k]);
    }
    this.li.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Upright card (texture's bottom edge on the ground): used for grass, stems, twig clusters. */
  upCard(card: Card, base: V3, up: V3, side: V3, height: number, width: number, normal: V3, ao: number, sway: number, aoBase = 1) {
    const [u0, v0, u1, v1] = cellUV(card);
    const i0 = this.lp.length / 3;
    const w = side.clone().multiplyScalar(width / 2);
    const top = base.clone().addScaledVector(up, height);
    const corners = [base.clone().sub(w), base.clone().add(w), top.clone().add(w), top.clone().sub(w)];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const swayK = [0.1, 0.1, 1, 1];
    for (let k = 0; k < 4; k++) {
      const p = corners[k];
      const a = k < 2 ? ao * aoBase : ao;
      this.lp.push(p.x, p.y, p.z);
      this.ln.push(normal.x, normal.y, normal.z);
      this.lu.push(uv[k][0], uv[k][1]);
      this.lc.push(a, a, a);
      this.lw.push(sway * swayK[k]);
    }
    this.li.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  build(): { bark: THREE.BufferGeometry; leaf: THREE.BufferGeometry } {
    const bark = new THREE.BufferGeometry();
    bark.setAttribute("position", new THREE.Float32BufferAttribute(this.bp, 3));
    bark.setAttribute("normal", new THREE.Float32BufferAttribute(this.bn, 3));
    bark.setAttribute("uv", new THREE.Float32BufferAttribute(this.bu, 2));
    bark.setIndex(this.bi);
    bark.computeBoundingSphere();
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute("position", new THREE.Float32BufferAttribute(this.lp, 3));
    leaf.setAttribute("normal", new THREE.Float32BufferAttribute(this.ln, 3));
    leaf.setAttribute("uv", new THREE.Float32BufferAttribute(this.lu, 2));
    leaf.setAttribute("color", new THREE.Float32BufferAttribute(this.lc, 3));
    leaf.setAttribute("aSway", new THREE.Float32BufferAttribute(this.lw, 1));
    leaf.setIndex(this.li);
    leaf.computeBoundingSphere();
    return { bark, leaf };
  }
}

/** Gently wobbling line from a to b. */
function wobblyLine(rnd: () => number, a: V3, b: V3, n: number, wob: number, droop = 0): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    if (i > 0 && i < n) p.add(v((rnd() - 0.5) * wob, (rnd() - 0.5) * wob * 0.5, (rnd() - 0.5) * wob));
    p.y -= droop * t * t;
    pts.push(p);
  }
  return pts;
}

const UP = v(0, 1, 0);

/** Narrow spires: spruce, balsam fir, tamarack, cedar, young spruce. */
function conifer(b: Builder, rnd: () => number, h: number, opts: { card: Card; widthRatio: number; droop: number; layers: number; perLayer: number; bark: number; cardW: number; spire?: number; core?: boolean }) {
  const trunkR = h * 0.018 * opts.bark;
  const trunk: V3[] = [], radii: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    trunk.push(v((rnd() - 0.5) * 0.08 * t * h * 0.05, t * h, (rnd() - 0.5) * 0.08 * t * h * 0.05));
    radii.push(trunkR * (1 - t * 0.92) + 0.01);
  }
  b.tube(trunk, radii, 7, 2);
  const maxR = h * opts.widthRatio;
  const crownBase = h * (0.08 + rnd() * 0.12);
  for (let l = 0; l < opts.layers; l++) {
    const t = l / (opts.layers - 1);
    const y = crownBase + (h * 0.98 - crownBase) * t;
    const shape = Math.pow(1 - t, opts.spire ?? 1.0);
    const R = maxR * (0.15 + 0.85 * shape) * (0.85 + rnd() * 0.3);
    const count = Math.max(3, Math.round(opts.perLayer * (0.5 + 0.5 * shape)));
    const off = rnd() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const a = off + (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const out = v(Math.cos(a), 0, Math.sin(a));
      const down = -opts.droop * (0.4 + rnd() * 0.6) * (1 - t * 0.6);
      const dir = out.clone().multiplyScalar(Math.cos(down)).add(v(0, Math.sin(down), 0)).normalize();
      const root = v(0, y, 0).addScaledVector(out, trunkR * (1 - t));
      const n = out.clone().multiplyScalar(0.8).add(v(0, 0.55, 0)).normalize();
      const ao = 0.55 + 0.45 * Math.min(1, t * 0.7 + 0.35 + rnd() * 0.15);
      // three cards rolled around the branch so the spray reads from any side
      const roll0 = rnd() * Math.PI;
      for (let c = 0; c < 3; c++) {
        const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
        side.applyAxisAngle(dir, roll0 + (c * Math.PI) / 3 + (rnd() - 0.5) * 0.3);
        const len = R * (c === 0 ? 1.05 : 0.85 + rnd() * 0.15);
        b.card(opts.card, root, dir, side, len, R * opts.cardW * (c === 0 ? 1 : 0.8), n, ao * (c === 0 ? 1 : 0.85), 0.25 + 0.6 * t, rnd() < 0.5);
      }
    }
  }
  // dense core: tall cards through the trunk fill the gaps between whorls (spruce/fir look solid)
  if (opts.core) {
    const coreCount = 5;
    for (let c = 0; c < coreCount; c++) {
      const a = (c / coreCount) * Math.PI + rnd() * 0.2;
      const side = v(Math.cos(a), 0, Math.sin(a));
      const segs = 4;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const y = crownBase + (h * 0.92 - crownBase) * t0;
        const shape = Math.pow(1 - t0 - 0.5 / segs, opts.spire ?? 1);
        const w = maxR * 2 * (0.2 + 0.8 * shape) * 0.9;
        const n = v(-Math.sin(a), 0.5, Math.cos(a)).normalize();
        b.upCard(opts.card, v(0, y, 0), UP, side, (h * 0.92 - crownBase) / segs * 1.3, w, n, 0.55 + 0.3 * t0, 0.2);
      }
    }
  }
  // the leader at the very top
  b.upCard(opts.card === Card.Tamarack ? Card.Tamarack : Card.Sapling, v(0, h * 0.9, 0), UP, v(1, 0, 0), h * 0.12, h * 0.07, v(0, 1, 0), 1, 0.8);
}

/** White pine: tall, open, irregular horizontal tiers of soft tufts. The skyline tree of Ontario. */
function whitePine(b: Builder, rnd: () => number, h: number) {
  const trunkR = h * 0.022;
  const lean = v((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.06);
  const trunk: V3[] = [], radii: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    trunk.push(v(lean.x * t * h + (rnd() - 0.5) * 0.1, t * h, lean.z * t * h + (rnd() - 0.5) * 0.1));
    radii.push(trunkR * (1 - t * 0.85) + 0.02);
  }
  b.tube(trunk, radii, 8, 2);
  // wind-swept: tiers stretch farther to one side (east, away from the prevailing west wind)
  const sweep = v(1, 0, (rnd() - 0.5) * 0.6).normalize();
  const tiers = 5 + Math.floor(rnd() * 3);
  for (let k = 0; k < tiers; k++) {
    const t = 0.42 + (k / tiers) * 0.55;
    const y = h * t;
    const at = trunk[Math.round(t * 10)].clone().setY(y);
    const nBranch = 2 + Math.floor(rnd() * 3);
    for (let j = 0; j < nBranch; j++) {
      const a = rnd() * Math.PI * 2;
      let out = v(Math.cos(a), 0, Math.sin(a));
      out.lerp(sweep, 0.35).normalize();
      const len = h * (0.12 + 0.2 * (1 - t)) * (0.6 + rnd() * 0.6) * (1 + 0.5 * Math.max(0, out.dot(sweep)));
      const end = at.clone().addScaledVector(out, len).add(v(0, len * (0.05 + rnd() * 0.15), 0));
      const pts = wobblyLine(rnd, at, end, 4, len * 0.08, -len * 0.08);
      b.tube(pts, pts.map((_, i) => trunkR * 0.35 * (1 - i / pts.length) + 0.015), 5);
      // tufts along the outer half of the branch, facing up
      for (let q = 0; q < 9; q++) {
        const tt = 0.3 + q * 0.085 + rnd() * 0.05;
        const p = pts[Math.min(pts.length - 1, Math.floor(tt * (pts.length - 1)))].clone().lerp(end, tt * 0.3);
        const dir = out.clone().applyAxisAngle(UP, (rnd() - 0.5) * 1.6).add(v(0, 0.15, 0)).normalize();
        const n = out.clone().multiplyScalar(0.5).add(v(0, 0.85, 0)).normalize();
        const roll = rnd() * Math.PI;
        for (let c = 0; c < 2; c++) {
          const side = new THREE.Vector3().crossVectors(dir, UP).normalize().applyAxisAngle(dir, roll + c * Math.PI / 2);
          b.card(Card.WhitePine, p, dir, side, h * 0.085 * (0.8 + rnd() * 0.5), h * 0.075, n, 0.6 + rnd() * 0.35, 0.7);
        }
      }
    }
  }
}

/** Broadleaf crown: recursive branches; tips get twig cards (bare) or leaf clusters (oak, beech). */
function hardwood(b: Builder, rnd: () => number, h: number, opts: { tipCard: Card; tipCard2?: Card; trunkFrac: number; spread: number; depth: number; tipSize: number; birch?: boolean }) {
  const trunkR = h * (opts.birch ? 0.014 : 0.02);
  const crownTop = v((rnd() - 0.5) * h * 0.08, h, (rnd() - 0.5) * h * 0.08);
  const tips: { p: V3; dir: V3; depth: number }[] = [];
  const mids: { p: V3; dir: V3 }[] = [];
  const grow = (from: V3, dir: V3, len: number, r: number, depth: number) => {
    const end = from.clone().addScaledVector(dir, len);
    const pts = wobblyLine(rnd, from, end, depth === 0 ? 6 : 3, len * 0.07, depth > 1 ? len * 0.06 : 0);
    b.tube(pts, pts.map((_, i) => r * (1 - (i / (pts.length - 1)) * 0.38)), depth === 0 ? 8 : depth === 1 ? 6 : 4, depth === 0 ? 2 : 1);
    if (depth >= opts.depth) { tips.push({ p: end, dir, depth }); return; }
    if (depth === 1) mids.push({ p: pts[Math.floor(pts.length / 2)], dir });
    const kids = depth === 0 ? 4 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < kids; k++) {
      const t = depth === 0 ? opts.trunkFrac + (1 - opts.trunkFrac) * (k / kids) * 0.9 : 0.45 + rnd() * 0.55;
      const at = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
      const az = rnd() * Math.PI * 2;
      const outward = v(Math.cos(az), 0, Math.sin(az));
      const up = depth === 0 ? 0.55 + rnd() * 0.5 : 0.25 + rnd() * 0.5;
      const nd = dir.clone().multiplyScalar(depth === 0 ? 0.3 : 0.55).addScaledVector(outward, opts.spread).add(v(0, up, 0)).normalize();
      // aim the first order branches at a rounded crown envelope
      const kidLen = depth === 0 ? h * (0.28 + rnd() * 0.12) * (1.15 - t * 0.6) : len * (0.55 + rnd() * 0.2);
      grow(at, nd, kidLen, r * (depth === 0 ? 0.45 : 0.6), depth + 1);
    }
  };
  // trunk goes most of the way up, leaning to crownTop
  const trunkDir = crownTop.clone().normalize();
  grow(v(0, 0, 0), trunkDir, h * 0.82, trunkR, 0);
  for (const tip of tips) {
    const cnt = 3 + Math.floor(rnd() * 2);
    for (let c = 0; c < cnt; c++) {
      const card = opts.tipCard2 && rnd() < 0.4 ? opts.tipCard2 : opts.tipCard;
      const up = tip.dir.clone().applyAxisAngle(UP, (rnd() - 0.5) * 1.2).add(v((rnd() - 0.5) * 0.7, 0.5, (rnd() - 0.5) * 0.7)).normalize();
      const n = tip.p.clone().sub(v(0, h * 0.6, 0)).normalize();
      const s = h * opts.tipSize * (0.75 + rnd() * 0.5);
      const az = rnd() * Math.PI;
      for (let k = 0; k < 2; k++) {
        const side = new THREE.Vector3().crossVectors(up, v(Math.cos(az + k * Math.PI / 2), 0, Math.sin(az + k * Math.PI / 2))).normalize();
        b.upCard(card, tip.p.clone().addScaledVector(up, -s * 0.3), up, side, s, s, n, 0.7 + rnd() * 0.3, 0.6);
      }
    }
  }
  for (const m of mids) {
    const up = m.dir.clone().add(v(0, 0.6, 0)).normalize();
    const n = m.p.clone().sub(v(0, h * 0.6, 0)).normalize();
    const s = h * opts.tipSize * 0.8;
    const az = rnd() * Math.PI;
    for (let k = 0; k < 2; k++) {
      const side = new THREE.Vector3().crossVectors(up, v(Math.cos(az + k * Math.PI / 2), 0, Math.sin(az + k * Math.PI / 2))).normalize();
      b.upCard(opts.tipCard2 ?? opts.tipCard, m.p, up, side, s, s, n, 0.6, 0.4);
    }
  }
}

/** Shrubs and saplings: a fan of upright stem cards. */
function shrub(b: Builder, rnd: () => number, h: number, card: Card, cards: number, width = 1) {
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI + rnd() * 0.4;
    const side = v(Math.cos(a), 0, Math.sin(a));
    const lean = v((rnd() - 0.5) * 0.35, 1, (rnd() - 0.5) * 0.35).normalize();
    const base = v((rnd() - 0.5) * h * 0.3, -0.05, (rnd() - 0.5) * h * 0.3);
    const n = new THREE.Vector3().crossVectors(side, UP).normalize().add(v(0, 0.6, 0)).normalize();
    b.upCard(card, base, lean, side, h * (0.75 + rnd() * 0.35), h * 1.1 * width, n, 0.75 + rnd() * 0.25, 0.8);
  }
}

/** A unit clump (1 m wide, 1 m tall) of crossed ground-plant cards: grass, goldenrod, fern. */
export function makeClump(card: Card, cards = 3, seed = 1, aoBase = 0.62): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const b = new Builder();
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI + (rnd() - 0.5) * 0.3;
    const side = v(Math.cos(a), 0, Math.sin(a));
    const n = v(-Math.sin(a) * 0.35, 1, Math.cos(a) * 0.35).normalize();
    const lean = v((rnd() - 0.5) * 0.15, 1, (rnd() - 0.5) * 0.15).normalize();
    b.upCard(card, v((rnd() - 0.5) * 0.2, -0.04, (rnd() - 0.5) * 0.2), lean, side, 1, 1, n, 1, 1, aoBase);
  }
  return b.build().leaf;
}

export function makeTree(species: Species, seed: number, height: number): TreeModel {
  const rnd = mulberry32(seed);
  const b = new Builder();
  let bark: BarkKind = "spruce";
  let radius = height * 0.2;
  switch (species) {
    case "spruce":
      conifer(b, rnd, height, { card: Card.Spruce, widthRatio: 0.2, droop: 0.45, layers: 30, perLayer: 8, bark: 1, cardW: 1.0, spire: 0.9, core: true });
      radius = height * 0.2; break;
    case "fir":
      conifer(b, rnd, height, { card: Card.Fir, widthRatio: 0.18, droop: 0.15, layers: 28, perLayer: 7, bark: 0.9, cardW: 0.95, spire: 1.15, core: true });
      radius = height * 0.18; break;
    case "cedar":
      conifer(b, rnd, height, { card: Card.Cedar, widthRatio: 0.19, droop: 0.2, layers: 24, perLayer: 8, bark: 1.3, cardW: 1.1, spire: 0.7, core: true });
      bark = "pine"; radius = height * 0.19; break;
    case "tamarack":
      conifer(b, rnd, height, { card: Card.Tamarack, widthRatio: 0.18, droop: -0.05, layers: 22, perLayer: 6, bark: 1, cardW: 0.85, spire: 1.0, core: true });
      bark = "pine"; radius = height * 0.18; break;
    case "sapling":
      conifer(b, rnd, height, { card: Card.Sapling, widthRatio: 0.26, droop: 0.2, layers: 10, perLayer: 6, bark: 1.2, cardW: 1.05, spire: 0.9, core: true });
      radius = height * 0.24; break;
    case "juniper":
      conifer(b, rnd, height, { card: Card.Cedar, widthRatio: 0.6, droop: 0.3, layers: 4, perLayer: 9, bark: 1.4, cardW: 1.1, spire: 0.6 });
      bark = "pine"; radius = height * 0.6; break;
    case "whitepine":
      whitePine(b, rnd, height); bark = "pine"; radius = height * 0.3; break;
    case "maple":
      hardwood(b, rnd, height, { tipCard: Card.TwigMaple, trunkFrac: 0.35, spread: 0.75, depth: 2, tipSize: 0.27 }); bark = "maple"; radius = height * 0.34; break;
    case "birch":
      hardwood(b, rnd, height, { tipCard: Card.TwigFine, trunkFrac: 0.5, spread: 0.55, depth: 2, tipSize: 0.25, birch: true }); bark = "birch"; radius = height * 0.24; break;
    case "oak":
      hardwood(b, rnd, height, { tipCard: Card.Oak, tipCard2: Card.TwigMaple, trunkFrac: 0.3, spread: 0.95, depth: 2, tipSize: 0.28 }); bark = "oak"; radius = height * 0.38; break;
    case "beech":
      hardwood(b, rnd, height, { tipCard: Card.Beech, trunkFrac: 0.25, spread: 0.85, depth: 2, tipSize: 0.32 }); bark = "maple"; radius = height * 0.37; break;
    case "dogwood": shrub(b, rnd, height, Card.Dogwood, 7); radius = height * 0.6; break;
    case "alder": shrub(b, rnd, height, Card.Alder, 8, 1.1); radius = height * 0.6; break;
    case "sumac": shrub(b, rnd, height, Card.Sumac, 5); radius = height * 0.5; break;
  }
  const { bark: barkGeo, leaf: leafGeo } = b.build();
  return { species, bark, barkGeo, leafGeo, height, radius };
}
