// Ground plants: clumps of dry grass, goldenrod and dead bracken, generated for whatever
// part of the ground the camera can see. Clumps sit on a world-anchored grid whose cell size
// grows with (distance ÷ magnification), so the same grass appears in the same place, dense
// where you're looking closely and sparse far away.
import * as THREE from "three";
import { Card } from "./foliageTextures";
import { sampleGround, type Ground } from "./layout";
import { hash2, smoothstep } from "./noise";
import { makeClump } from "./treeGen";
import { foliageMaterial, foliageDepthMaterial } from "./vegMaterials";

const BASE_CELL = 0.55;   // m, finest grid
const MAX_LEVEL = 5;
const CAP = 14000;

type Kind = { mesh: THREE.InstancedMesh; n: number };

export class Grass {
  readonly group = new THREE.Group();
  private grass: Kind;
  private rod: Kind;
  private fern: Kind;
  private lastKey = "";
  private g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };

  constructor(atlas: THREE.Texture, private heightAt: (x: number, z: number) => number) {
    const mat = foliageMaterial(atlas);
    const depth = foliageDepthMaterial(atlas);
    const mk = (card: Card, cap: number, seed: number): Kind => {
      const mesh = new THREE.InstancedMesh(makeClump(card, 3, seed), mat, cap);
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
    for (const k of [this.grass, this.rod, this.fern]) k.n = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
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
      for (let cz = Math.floor(minZ / cell); cz <= Math.ceil(maxZ / cell); cz++) {
        for (let cx = Math.floor(minX / cell); cx <= Math.ceil(maxX / cell); cx++) {
          if (this.grass.n >= CAP) break;
          const x = (cx + hash2(cx, cz, level * 7 + 1)) * cell, z = (cz + hash2(cx, cz, level * 7 + 2)) * cell;
          const r = Math.hypot(x, z), a = Math.atan2(x, -z);
          if (r < r0 || r >= r1 || a < a0 || a > a1) continue;
          sampleGround(x, z, g);
          const y = this.heightAt(x, z);
          const h1 = hash2(cx, cz, level * 7 + 3), h2 = hash2(cx, cz, level * 7 + 4);
          q.setFromAxisAngle(up, h1 * Math.PI * 2);
          if (g.open < 0.35) {
            // bush floor: a few dead ferns near the edge
            if (g.edge > -25 && h2 < 0.25 && this.fern.n < 2000) {
              const sz = Math.max(cell * 1.3, 0.9);
              p.set(x, y, z); s.set(sz, 0.6 + h1 * 0.4, sz);
              m4.compose(p, q, s);
              col.setRGB(0.9 + h2 * 0.3, 0.85 + h2 * 0.2, 0.8);
              this.fern.mesh.setMatrixAt(this.fern.n, m4); this.fern.mesh.setColorAt(this.fern.n, col); this.fern.n++;
            }
            continue;
          }
          const tall = Math.max(g.tall, g.hedge * 0.8, g.swale);
          const height = tall > 0.5 ? 0.38 + 0.36 * h2 : 0.13 + 0.1 * h2 + 0.3 * tall;
          // far away, short stubble is just ground colour; wide flat cards would line up like bricks
          if (level >= 2 && height < 0.3) continue;
          if (level >= 2 && h1 > 0.65) continue; // thinner with distance: the ground colour carries it
          if (level >= 3 && h2 > 0.5) continue;
          const width = Math.min(cell * (1.25 + 0.4 * h1), Math.max(0.8, height * 3));
          p.set(x, y, z);
          s.set(width, height * (0.7 + 0.3 * smoothstep(0.35, 0.8, g.open)), width);
          m4.compose(p, q, s);
          // colour: straw / grey-tan / russet, a touch of green in the hay
          const t = hash2(cx, cz, 99);
          if (tall > 0.5) col.setRGB(0.98 + 0.14 * t, 0.94 + 0.1 * t, 0.86 + 0.06 * h2);
          else col.setRGB(0.95 + 0.08 * t, 1.0 + 0.08 * h2, 0.82 + 0.06 * t);
          this.grass.mesh.setMatrixAt(this.grass.n, m4); this.grass.mesh.setColorAt(this.grass.n, col); this.grass.n++;
          // goldenrod patches in the old field
          if (tall > 0.5 && this.rod.n < 3000) {
            const patch = Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06 - x * 0.02);
            if (patch > 0.5 && h1 > 0.62) {
              s.set(width * 0.8, 0.72 + 0.3 * h2, width * 0.8);
              m4.compose(p, q, s);
              col.setRGB(1, 1, 1);
              this.rod.mesh.setMatrixAt(this.rod.n, m4); this.rod.mesh.setColorAt(this.rod.n, col); this.rod.n++;
            }
          }
        }
      }
      if (this.grass.n === total && r1 >= rMax) break;
      r0 = r1;
    }
    for (const k of [this.grass, this.rod, this.fern]) {
      k.mesh.count = k.n;
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    }
  }
}
