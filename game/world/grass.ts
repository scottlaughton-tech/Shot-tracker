// Ground plants: clumps of dry grass, goldenrod and dead bracken, generated for whatever
// part of the ground the camera can see. Clumps sit on a world-anchored grid whose cell size
// grows with (distance ÷ magnification), so the same grass appears in the same place, dense
// where you're looking closely and sparse far away.
import * as THREE from "three";
import { Card } from "./foliageTextures";
import { MEADOW_HEIGHT, sampleGroundFast, type Ground } from "./layout";
import { hash2, smoothstep } from "./noise";
import { makeClump } from "./treeGen";
import { foliageMaterial, foliageDepthMaterial } from "./vegMaterials";
import { uploadInstances } from "./instances";

const BASE_CELL = 0.55;   // m, finest grid
const MAX_LEVEL = 5;
const CAP = 14000;

type Kind = { mesh: THREE.InstancedMesh; n: number };

export class Grass {
  readonly group = new THREE.Group();
  private grass: Kind;
  private hay: Kind;
  private rod: Kind;
  private fern: Kind;
  private lastKey = "";
  private g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };

  constructor(atlas: THREE.Texture, private heightAt: (x: number, z: number) => number) {
    const mat = foliageMaterial(atlas);
    const depth = foliageDepthMaterial(atlas);
    const mk = (card: Card, cap: number, seed: number, cards = 3, aoBase = 0.62): Kind => {
      const mesh = new THREE.InstancedMesh(makeClump(card, cards, seed, aoBase), mat, cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.customDepthMaterial = depth;
      this.group.add(mesh);
      return { mesh, n: 0 };
    };
    this.grass = mk(Card.Grass, CAP, 3);
    // distant grass: evenly lit (no dark base) so overlapping clumps read as one surface
    this.hay = mk(Card.Grass, 9000, 11, 3, 0.97);
    this.rod = mk(Card.Goldenrod, 3000, 5);
    this.fern = mk(Card.Fern, 2000, 7);
  }

  /**
   * @param rMin,rMax  visible ground distances along the view
   * @param yaw,halfW  view direction and half-width (radians)
   */
  update(rMin: number, rMax: number, yaw: number, halfW: number, magnification: number) {
    const key = `${rMin.toFixed(0)}|${rMax.toFixed(0)}|${yaw.toFixed(3)}|${halfW.toFixed(3)}|${magnification.toFixed(1)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const k of [this.grass, this.hay, this.rod, this.fern]) k.n = 0;
    // write each clump straight into the instance arrays: a turn about the vertical, a size, a tint
    let cr = 1, sr = 0;
    const put = (k: Kind, x: number, y: number, z: number, sx: number, sy: number, r: number, gg: number, b: number) => {
      const m = k.mesh.instanceMatrix.array as Float32Array, c = k.mesh.instanceColor!.array as Float32Array;
      const o = k.n * 16;
      m[o] = cr * sx; m[o + 1] = 0; m[o + 2] = -sr * sx; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sr * sx; m[o + 9] = 0; m[o + 10] = cr * sx; m[o + 11] = 0;
      m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
      c[k.n * 3] = r; c[k.n * 3 + 1] = gg; c[k.n * 3 + 2] = b;
      k.n++;
    };
    const g = this.g;
    rMin = Math.max(5, rMin);
    rMax = Math.min(1500, rMax);
    // walk out in bands where one grid level applies
    let r0 = rMin;
    while (r0 < rMax) {
      const eff = r0 / magnification;
      const level = Math.max(0, Math.min(MAX_LEVEL, Math.floor(Math.log2(Math.max(1, eff / 11)))));
      const cell = BASE_CELL * (1 << level);
      // this level holds until the effective distance doubles
      const r1 = Math.min(rMax, Math.max(r0 + cell, 11 * magnification * (1 << (level + 1))));
      // cells covering the sector piece [r0, r1] × [yaw - halfW, yaw + halfW]
      const a0 = yaw - halfW, a1 = yaw + halfW;
      const pts = [[r0, a0], [r0, a1], [r1, a0], [r1, a1], [r1, yaw]];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [r, a] of pts) { const x = r * Math.sin(a), z = -r * Math.cos(a); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const total = this.grass.n;
      const t0 = Math.tan(a0), t1 = Math.tan(a1);
      for (let cz = Math.floor(minZ / cell); cz <= Math.ceil(maxZ / cell); cz++) {
        // only the stretch of this row inside the wedge (scanning the whole bounding box wasted ~80%
        // of the work when the scope looks off to one side); rows by the stand scan the whole box
        const zA = cz * cell, zB = zA + cell;
        let cx0 = Math.floor(minX / cell), cx1 = Math.ceil(maxX / cell);
        if (zB < -1 && Math.abs(a0) < 1.4 && Math.abs(a1) < 1.4) {
          const lo = Math.min(-zA * t0, -zB * t0), hi = Math.max(-zA * t1, -zB * t1);
          const reach = Math.sqrt(Math.max(0, r1 * r1 - zB * zB));
          cx0 = Math.max(cx0, Math.floor(Math.max(lo, -reach) / cell) - 1);
          cx1 = Math.min(cx1, Math.ceil(Math.min(hi, reach) / cell));
        }
        for (let cx = cx0; cx <= cx1; cx++) {
          if (this.grass.n >= CAP) break;
          const x = (cx + hash2(cx, cz, level * 7 + 1)) * cell, z = (cz + hash2(cx, cz, level * 7 + 2)) * cell;
          const r = Math.hypot(x, z), a = Math.atan2(x, -z);
          if (r < r0 || r >= r1 || a < a0 || a > a1) continue;
          sampleGroundFast(x, z, g);
          const y = this.heightAt(x, z);
          const h1 = hash2(cx, cz, level * 7 + 3), h2 = hash2(cx, cz, level * 7 + 4);
          cr = Math.cos(h1 * Math.PI * 2); sr = Math.sin(h1 * Math.PI * 2);
          if (g.open < 0.35) {
            // bush floor: a few dead ferns near the edge
            if (g.edge > -25 && h2 < 0.25 && this.fern.n < 2000) {
              const sz = Math.max(cell * 1.3, 0.9);
              put(this.fern, x, y, z, sz, 0.6 + h1 * 0.4, 0.9 + h2 * 0.3, 0.85 + h2 * 0.2, 0.8);
            }
            continue;
          }
          const tall = Math.max(g.tall, g.hedge * 0.8, g.swale);
          // old field near the stand; beyond the swale an unmown meadow of shorter grass
          const height = (0.38 + 0.36 * h2) * (MEADOW_HEIGHT + (1 - MEADOW_HEIGHT) * tall);
          // far away, short stubble is just ground colour; wide flat cards would line up like bricks
          if (level >= 2 && height < 0.22) continue;
          if (level >= 2 && h1 > 0.65) continue; // thinner with distance: the ground colour carries it
          if (level >= 3 && h2 > 0.5) continue;
          const hgt = height * (0.7 + 0.3 * smoothstep(0.35, 0.8, g.open));
          // colour drifts smoothly across the field (patches), with a little per-clump variety close up
          const drift = 0.5 + 0.5 * Math.sin(x * 0.031 + Math.sin(z * 0.023) * 2.1) * Math.cos(z * 0.027 - x * 0.011);
          const t = level === 0 ? hash2(cx, cz, 99) * 0.6 + drift * 0.4 : drift;
          const cr0 = tall > 0.5 ? 0.98 + 0.14 * t : 0.96 + 0.1 * t;
          const cg0 = tall > 0.5 ? 0.94 + 0.1 * t : 0.97 + 0.08 * t;
          const cb0 = tall > 0.5 ? 0.86 + 0.05 * t : 0.82 + 0.05 * t;
          if (level === 0) {
            const width = Math.min(cell * (1.25 + 0.4 * h1), Math.max(0.8, height * 3));
            put(this.grass, x, y, z, width, hgt, cr0, cg0, cb0);
          } else if (this.hay.n < 9000) {
            put(this.hay, x, y, z, cell * (1.6 + 0.3 * h1), hgt, cr0, cg0, cb0);
          }
          // goldenrod patches in the old field
          if (tall > 0.5 && this.rod.n < 3000) {
            const patch = Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06 - x * 0.02);
            if (patch > 0.5 && h1 > 0.62) {
              put(this.rod, x, y, z, Math.min(cell * 1.2, 1.1), 0.72 + 0.3 * h2, 1, 1, 1);
            }
          }
        }
      }
      if (this.grass.n === total && r1 >= rMax) break;
      r0 = r1;
    }
    for (const k of [this.grass, this.hay, this.rod, this.fern]) {
      k.mesh.count = k.n;
      uploadInstances(k.mesh, k.n);
    }
  }
}
