// Canadian Shield granite: boulders along the field edges, in the bush, and a few big
// glacial erratics out in the field. Lumpy displaced spheres, textured with a triplanar
// photo texture and lichen patches.
import * as THREE from "three";
import { uploadInstances } from "./instances";
import { sampleGroundFast, STAND, type Ground } from "./layout";
import { hash2, makeNoise2D, mulberry32 } from "./noise";
import type { Photos } from "./photoTextures";

const VARIANTS = 4;
type Inst = { v: number; x: number; y: number; z: number; s: number; rx: number; ry: number; dist: number; azim: number };

function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = makeNoise2D(seed), n2 = makeNoise2D(seed + 7);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const sx = 0.8 + rnd() * 0.5, sy = 0.45 + rnd() * 0.3, sz = 0.7 + rnd() * 0.5;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // lumpy, with a few flat fracture faces
    const lump = 0.22 * n(v.x * 1.3 + v.z * 0.7, v.y * 1.3 + 3) + 0.08 * n2(v.x * 4 + v.y * 2, v.z * 4);
    const facet = Math.max(0, v.dot(new THREE.Vector3(0.6, 0.5, 0.62)) - 0.55) * 0.6;
    v.multiplyScalar(1 + lump - facet);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.25; // sits in the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

function rockMaterial(photos: Photos | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: photos ? "#ffffff" : "#8b8478", roughness: 0.92, metalness: 0 });
  if (!photos) return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: photos.rock };
    sh.uniforms.uRockN = { value: photos.rockN };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRockP;\nvarying vec3 vRockN;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
float rs = 1.0;
#ifdef USE_INSTANCING
  rs = length(instanceMatrix[0].xyz);
#endif
vRockP = position * rs;
vRockN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uRock;\nuniform sampler2D uRockN;\nvarying vec3 vRockP;\nvarying vec3 vRockN;")
      .replace("#include <map_fragment>", `{
  vec3 w = pow(abs(normalize(vRockN)), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec3 p = vRockP * 0.45;
  vec3 c = texture2D(uRock, p.yz).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
  // grey Shield granite, with pale green-grey lichen on the tops
  c = mix(c, vec3(dot(c, vec3(0.33))), 0.45) * vec3(0.95, 0.95, 0.97);
  float lich = smoothstep(0.55, 0.75, texture2D(uRock, p.xz * 0.31 + 0.5).g) * smoothstep(0.2, 0.7, normalize(vRockN).y);
  c = mix(c, vec3(0.62, 0.66, 0.52), lich * 0.6);
  diffuseColor.rgb *= c;
}`);
  };
  m.customProgramCacheKey = () => "rock-v1";
  return m;
}

export class Rocks {
  readonly group = new THREE.Group();
  private inst: Inst[] = [];
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];

  constructor(heightAt: (x: number, z: number) => number, photos: Photos | null) {
    const g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };
    const rnd = mulberry32(4242);
    const add = (x: number, z: number, s: number) => {
      const r = Math.hypot(x - STAND.x, z - STAND.z), azim = Math.atan2(x, -z);
      if (r < 8 || Math.abs(azim) > 1.0) return;
      this.inst.push({ v: Math.floor(rnd() * VARIANTS), x, y: heightAt(x, z) - s * 0.12, z, s, rx: (rnd() - 0.5) * 0.3, ry: rnd() * Math.PI * 2, dist: r, azim });
    };
    // scattered on a jittered grid, mostly near the field edge
    const S = 7;
    for (let cz = Math.floor(-1150 / S); cz < 2; cz++) for (let cx = Math.floor(-1000 / S); cx < Math.ceil(1000 / S); cx++) {
      const x = (cx + hash2(cx, cz, 71)) * S, z = (cz + hash2(cx, cz, 72)) * S;
      if (Math.hypot(x, z) > 1150) continue;
      const h = hash2(cx, cz, 73);
      sampleGroundFast(x, z, g);
      const atEdge = g.edge > -10 && g.edge < 5;
      const chance = atEdge ? 0.09 : g.open < 0.3 ? 0.025 : 0.004;
      if (h > chance) continue;
      const big = hash2(cx, cz, 74);
      add(x, z, big > 0.93 ? 1.3 + big * 1.2 : 0.3 + big * 0.8);
    }
    // a few big erratics out in the open
    for (let i = 0; i < 14; i++) {
      const a = (rnd() - 0.5) * 1.2, r = 90 + rnd() * 800;
      const x = r * Math.sin(a), z = -r * Math.cos(a);
      if (sampleGroundFast(x, z, g).open > 0.9) add(x, z, 1.2 + rnd() * 1.6);
    }
    // one right in front of the stand for scale
    add(-9, -14, 1.1);
    const mat = rockMaterial(photos);
    for (let v = 0; v < VARIANTS; v++) {
      const count = this.inst.filter((i) => i.v === v).length || 1;
      for (const [list, detail] of [[this.near, 3], [this.far, 1]] as const) {
        const m = new THREE.InstancedMesh(rockGeometry(300 + v * 17, detail), mat, count);
        m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        list.push(m); this.group.add(m);
      }
    }
  }

  get count() { return this.inst.length; }

  update(yaw: number, halfW: number, magnification: number) {
    for (const m of [...this.near, ...this.far]) m.count = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const r of this.inst) {
      if (Math.abs(r.azim - yaw) > halfW + Math.atan2(r.s * 2, r.dist)) continue;
      const eff = r.dist / magnification;
      if (eff / r.s > 900) continue; // too small to see
      const mesh = (eff / r.s < 40 ? this.near : this.far)[r.v];
      q.setFromEuler(e.set(r.rx, r.ry, 0));
      m4.compose(p.set(r.x, r.y, r.z), q, s.setScalar(r.s));
      mesh.setMatrixAt(mesh.count++, m4);
    }
    for (const m of [...this.near, ...this.far]) uploadInstances(m, m.count);
  }
}
