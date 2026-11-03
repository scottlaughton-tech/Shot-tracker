// Ground mesh: a polar grid centred on the stand. The camera never moves, so rings that get
// wider with distance give fine detail up close and coarse detail far away for free.
import * as THREE from "three";
import { buildGroundCache, type Ground, sampleGround, sampleGroundFast } from "./layout";
import { smoothstep } from "./noise";

const R0 = 3;           // first ring, m
const RATIO = 1.02;     // each ring is 2% farther than the last...
const R_FAR = 1700;     // ...until the far bush, where rings spread out faster
const RATIO_FAR = 1.04;
const R_MAX = 9000;
const ANG = (62 * Math.PI) / 180; // half-width of the covered wedge
const DA = (0.25 * Math.PI) / 180;

export type Terrain = {
  mesh: THREE.Mesh;
  /** height of the rendered ground (matches the mesh exactly) */
  heightAt: (x: number, z: number) => number;
};

export function buildTerrain(material: THREE.Material): Terrain {
  buildGroundCache();
  const radii: number[] = [];
  for (let r = R0; r < R_MAX * RATIO_FAR; r *= r < R_FAR ? RATIO : RATIO_FAR) radii.push(r);
  const rings = radii.length;
  const cols = Math.round((2 * ANG) / DA) + 1;
  const n = rings * cols;
  const pos = new Float32Array(n * 3);
  const mask = new Float32Array(n * 4);
  const heights = new Float32Array(n);
  const g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };

  for (let i = 0; i < rings; i++) {
    const r = radii[i];
    for (let j = 0; j < cols; j++) {
      const a = -ANG + j * DA;
      const x = r * Math.sin(a), z = -r * Math.cos(a);
      const k = i * cols + j;
      if (r < 60) sampleGround(x, z, g); else sampleGroundFast(x, z, g);
      heights[k] = g.h;
      pos[k * 3] = x; pos[k * 3 + 1] = g.h; pos[k * 3 + 2] = z;
      mask[k * 4] = g.open;
      mask[k * 4 + 1] = g.tall;
      mask[k * 4 + 2] = Math.max(g.hedge, 0.8 * g.swale);
      // forest-floor "deepness" (used to darken under the canopy)
      mask[k * 4 + 3] = smoothstep(0, -30, g.edge);
    }
  }

  const index = new Uint32Array((rings - 1) * (cols - 1) * 6);
  let t = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      index[t++] = a; index[t++] = b; index[t++] = c;
      index[t++] = b; index[t++] = d; index[t++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aMask", new THREE.BufferAttribute(mask, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const lnRatio = Math.log(RATIO), lnFar = Math.log(RATIO_FAR);
  const iFar = radii.findIndex((r) => r >= R_FAR);
  const ringOf = (r: number) => {
    if (r < radii[iFar]) return Math.log(r / R0) / lnRatio;
    return iFar + Math.log(r / radii[iFar]) / lnFar;
  };
  const heightAt = (x: number, z: number) => {
    const r = Math.max(R0, Math.hypot(x, z));
    const fi = ringOf(r);
    const fj = (Math.atan2(x, -z) + ANG) / DA;
    const i = Math.min(rings - 2, Math.max(0, Math.floor(fi)));
    const j = Math.min(cols - 2, Math.max(0, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
    const k = i * cols + j;
    const h00 = heights[k], h01 = heights[k + 1], h10 = heights[k + cols], h11 = heights[k + cols + 1];
    // same diagonal split as the triangles
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };
  return { mesh, heightAt };
}
