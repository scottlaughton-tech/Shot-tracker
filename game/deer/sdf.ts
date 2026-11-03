// Signed-distance shapes and a surface-nets mesher. The buck's body is a smooth union of
// simple shapes (ellipsoids and tapered capsules); each shape belongs to a bone and a hit zone.
// Pure math, no three.js, so it can be unit-tested and reused for hit detection.

export type Vec = [number, number, number];

export type Prim =
  | { kind: "ell"; c: Vec; r: Vec; bone: string; k: number; tag: string }
  | { kind: "cone"; a: Vec; b: Vec; r1: number; r2: number; bone: string; k: number; tag: string };

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function sdEllipsoid(px: number, py: number, pz: number, c: Vec, r: Vec): number {
  const x = px - c[0], y = py - c[1], z = pz - c[2];
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

/** Tapered capsule from a (radius r1) to b (radius r2). Inigo Quilez's round cone. */
export function sdRoundCone(px: number, py: number, pz: number, a: Vec, b: Vec, r1: number, r2: number): number {
  const ba: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa: Vec = [px - a[0], py - a[1], pz - a[2]];
  const y = dot(pa, ba);
  const z = y - l2;
  const qx = pa[0] * l2 - ba[0] * y, qy = pa[1] * l2 - ba[1] * y, qz = pa[2] * l2 - ba[2] * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function primDist(p: Prim, x: number, y: number, z: number): number {
  return p.kind === "ell" ? sdEllipsoid(x, y, z, p.c, p.r) : sdRoundCone(x, y, z, p.a, p.b, p.r1, p.r2);
}

/** Polynomial smooth minimum (blend radius k). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function primBounds(p: Prim): [Vec, Vec] {
  const pad = p.k + 0.01;
  if (p.kind === "ell") {
    return [[p.c[0] - p.r[0] - pad, p.c[1] - p.r[1] - pad, p.c[2] - p.r[2] - pad], [p.c[0] + p.r[0] + pad, p.c[1] + p.r[1] + pad, p.c[2] + p.r[2] + pad]];
  }
  const r = Math.max(p.r1, p.r2) + pad;
  return [
    [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r],
    [Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r],
  ];
}

/** Buckets primitives into a coarse grid so each point only checks nearby shapes. */
export class ShapeField {
  private buckets: number[][];
  private bmin: Vec; private bsize: number; private dims: Vec;
  prims: Prim[];
  constructor(prims: Prim[], min: Vec, max: Vec, bucket = 0.08) {
    this.prims = prims;
    this.bmin = min; this.bsize = bucket;
    this.dims = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / bucket) + 1) as Vec;
    this.buckets = Array.from({ length: this.dims[0] * this.dims[1] * this.dims[2] }, () => []);
    prims.forEach((p, idx) => {
      const [lo, hi] = primBounds(p);
      const i0 = lo.map((v, i) => Math.max(0, Math.floor((v - min[i]) / bucket)));
      const i1 = hi.map((v, i) => Math.min(this.dims[i] - 1, Math.floor((v - min[i]) / bucket)));
      for (let a = i0[0]; a <= i1[0]; a++) for (let b = i0[1]; b <= i1[1]; b++) for (let c = i0[2]; c <= i1[2]; c++) this.buckets[(a * this.dims[1] + b) * this.dims[2] + c].push(idx);
    });
  }
  private near(x: number, y: number, z: number): number[] {
    const a = Math.floor((x - this.bmin[0]) / this.bsize), b = Math.floor((y - this.bmin[1]) / this.bsize), c = Math.floor((z - this.bmin[2]) / this.bsize);
    if (a < 0 || b < 0 || c < 0 || a >= this.dims[0] || b >= this.dims[1] || c >= this.dims[2]) return [];
    return this.buckets[(a * this.dims[1] + b) * this.dims[2] + c];
  }
  dist(x: number, y: number, z: number): number {
    let d = 1;
    for (const i of this.near(x, y, z)) { const p = this.prims[i]; d = smin(d, primDist(p, x, y, z), p.k); }
    return d;
  }
  /** Distances to every nearby primitive (for skin weights and colouring). */
  each(x: number, y: number, z: number, fn: (p: Prim, d: number, i: number) => void) {
    for (const i of this.near(x, y, z)) fn(this.prims[i], primDist(this.prims[i], x, y, z), i);
  }
}

export type RawMesh = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** Naive surface nets over the box at the given cell size. */
export function surfaceNets(field: ShapeField, min: Vec, max: Vec, cell: number): RawMesh {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    vals[id(i, j, k)] = field.dist(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  }
  // one vertex per cell that the surface passes through
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => (i * (ny - 1) + j) * (nz - 1) + k;
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) for (let k = 0; k < nz - 1; k++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = vals[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
      if (cv[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    cellVert[cid(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  // quads across every grid edge with a sign change
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const v0 = vals[id(i, j, k)];
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
      const v1 = vals[id(i + 1, j, k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], v0 < 0);
    }
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
      const v1 = vals[id(i, j + 1, k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], v0 < 0);
    }
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
      const v1 = vals[id(i, j, k + 1)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], v0 < 0);
    }
  }
  // snap vertices onto the surface and take normals from the field gradient
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.25;
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2];
    let gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 3; it++) {
      const d = field.dist(x, y, z);
      gx = field.dist(x + e, y, z) - field.dist(x - e, y, z);
      gy = field.dist(x, y + e, z) - field.dist(x, y - e, z);
      gz = field.dist(x, y, z + e) - field.dist(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const step = Math.max(-cell * 0.5, Math.min(cell * 0.5, d));
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    positions[v] = x; positions[v + 1] = y; positions[v + 2] = z;
    normals[v] = gx; normals[v + 1] = gy; normals[v + 2] = gz;
  }
  // make every triangle face outward (agree with the field gradient)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx2 = normals[a] + normals[b] + normals[c], ny2 = normals[a + 1] + normals[b + 1] + normals[c + 1], nz2 = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (fx * nx2 + fy * ny2 + fz * nz2 < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}
