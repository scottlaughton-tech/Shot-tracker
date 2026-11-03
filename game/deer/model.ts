// Builds the buck: skinned body mesh (surface nets over the anatomy shapes), skeleton,
// November coat colours, ears and eyes. The mesh is built once and shared by every deer.
import * as THREE from "three";
import { BODY, JOINTS, JOINT_POS } from "./anatomy";
import { ShapeField, surfaceNets, type Vec } from "./sdf";

export type DeerAsset = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  earGeometry: THREE.BufferGeometry;
  earMaterial: THREE.Material;
  eyeGeometry: THREE.BufferGeometry;
  eyeMaterial: THREE.Material;
  boneNames: string[];
};

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
type C = [number, number, number];
const mix = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// November "grey coat" palette (sRGB)
const COAT: C = [0.39, 0.33, 0.265];
const BACK: C = [0.27, 0.22, 0.17];
const LOWER: C = [0.47, 0.39, 0.3];
const WHITE: C = [0.84, 0.82, 0.78];
const BLACK: C = [0.06, 0.05, 0.045];
const FACE: C = [0.26, 0.2, 0.15];
const TAN: C = [0.5, 0.37, 0.25];
const LEGDARK: C = [0.33, 0.25, 0.18];
const HOOF: C = [0.14, 0.12, 0.11];
const TARSAL: C = [0.16, 0.11, 0.08];
const TAILTOP: C = [0.44, 0.31, 0.2];

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    r += hash3(ix + a, iy + b, iz + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
  }
  return r;
}

const EYE_L: Vec = [0.046, 1.392, 0.874];

/** Coat colour for a point on the body (bind pose), its normal, and the body part it's on. */
function coat(p: Vec, n: Vec, tag: string): C {
  const [x, y, z] = p;
  const side = Math.sign(x) || 1;
  const inward = -n[0] * side; // >0 on the inside of a leg
  let c: C;
  switch (tag) {
    case "head": {
      c = mix(COAT, FACE, ss(0.2, 0.7, n[1]) * ss(0.8, 0.86, z));
      const de = Math.hypot(Math.abs(x) - EYE_L[0], y - EYE_L[1], z - EYE_L[2]);
      c = mix(c, WHITE, ss(0.03, 0.022, de) * 0.9);
      // dark brow above the eye, lighter cheek below
      c = mix(c, LOWER, ss(0.0, -0.6, n[1]) * 0.5);
      break;
    }
    case "muzzle": case "jaw": case "nose": {
      c = mix(COAT, FACE, ss(0.1, 0.6, n[1]));
      // white band behind the black nose, white chin
      const band = ss(0.968, 0.982, z) * (1 - ss(1.0, 1.012, z)) * (1 - ss(0.35, 0.7, n[1]));
      c = mix(c, WHITE, band);
      if (tag === "jaw") c = mix(c, WHITE, ss(0.0, -0.5, n[1]) * ss(0.9, 0.97, z));
      if (tag === "nose" || z > 1.012) c = mix(c, BLACK, ss(1.008, 1.022, z) + (tag === "nose" ? 1 : 0));
      break;
    }
    case "neck": case "throat": {
      c = mix(LOWER, COAT, ss(-0.4, 0.3, n[1]));
      c = mix(c, BACK, ss(0.55, 0.9, n[1]));
      // white throat patch high on the front of the neck
      const dz = Math.hypot(x / 0.055, (y - 1.215) / 0.045, (z - 0.765) / 0.06);
      c = mix(c, WHITE, ss(1.15, 0.8, dz) * ss(-0.1, 0.4, n[2]));
      // rut-swollen neck is darker underneath
      c = mix(c, LEGDARK, ss(-0.3, -0.8, n[1]) * 0.35);
      break;
    }
    case "tail": {
      // hanging tail: brown on the outside, white fringe; white underneath shows when it's raised
      c = mix(TAILTOP, BACK, ss(0.015, 0, Math.abs(x)) * 0.5);
      c = mix(c, WHITE, ss(0.028, 0.04, Math.abs(x)) + ss(-0.2, 0.4, n[2]) * 0.9);
      break;
    }
    case "leg": case "hoof": {
      if (tag === "hoof") { c = HOOF; break; }
      c = mix(TAN, LEGDARK, ss(0.2, 0.8, n[2] * (z > 0 ? 1 : 0.6)) * 0.7);
      c = mix(c, WHITE, ss(0.1, 0.6, inward) * (y > 0.12 ? 0.85 : 0.4));
      // tarsal gland: dark, rut-stained tuft inside the hock
      if (z < 0) {
        const dt = Math.hypot(Math.abs(x) - 0.095, y - 0.47, z + 0.5);
        c = mix(c, TARSAL, ss(0.035, 0.02, dt) * ss(-0.1, 0.3, inward));
        // metatarsal gland outside the hind cannon
        const dm = Math.hypot(y - 0.29, z + 0.46);
        c = mix(c, WHITE, ss(0.02, 0.012, dm) * ss(0.2, 0.6, -inward) * 0.7);
      }
      // white "bracelet" just above the hooves
      c = mix(c, WHITE, ss(0.075, 0.06, y) * (1 - ss(0.04, 0.03, y)) * 0.6);
      break;
    }
    default: {
      // torso, shoulder, ham
      c = mix(LOWER, COAT, ss(-0.35, 0.35, n[1]));
      c = mix(c, BACK, ss(0.6, 0.92, n[1]));
      // white belly and inner thighs
      c = mix(c, WHITE, ss(-0.55, -0.82, n[1]) * (tag === "chest" ? 0.4 : 1));
      if (tag === "ham" || tag === "rump") {
        c = mix(c, WHITE, ss(0.2, 0.6, inward) * ss(0.85, 0.65, y));
        // white under the tail
        c = mix(c, WHITE, ss(-0.55, -0.9, n[2]) * ss(0.05, 0.025, Math.abs(x)) * ss(0.88, 0.8, y));
      }
      if (tag === "chest") c = mix(c, LEGDARK, ss(0.4, 0.8, n[2]) * ss(0.75, 0.6, y) * 0.4); // darker brisket
    }
  }
  // patchy grey/brown variation and fine grizzle
  const big = vnoise(x * 9, y * 9, z * 9), fine = vnoise(x * 60, y * 60, z * 60);
  const k = 0.92 + 0.12 * big + 0.08 * (fine - 0.5);
  return [c[0] * k, c[1] * k * 0.995, c[2] * k * 0.985];
}

function earGeometry(side: 1 | -1): THREE.BufferGeometry {
  // cupped oval, opening forward; built in the ear bone's frame
  const len = 0.175, wMax = 0.066;
  const dir = new THREE.Vector3(0.78 * side, 0.58, -0.22).normalize();
  const across = new THREE.Vector3(0, 0.25, 1).sub(dir.clone().multiplyScalar(dir.dot(new THREE.Vector3(0, 0.25, 1)))).normalize();
  const cupN = new THREE.Vector3().crossVectors(dir, across).multiplyScalar(side).normalize();
  if (cupN.z < 0) cupN.negate();
  const U = 10, V = 8;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const outer = new THREE.Color().setRGB(COAT[0], COAT[1], COAT[2], THREE.SRGBColorSpace);
  const inner = new THREE.Color().setRGB(0.8, 0.76, 0.7, THREE.SRGBColorSpace);
  const rim = new THREE.Color().setRGB(0.2, 0.16, 0.13, THREE.SRGBColorSpace);
  for (let layer = 0; layer < 2; layer++) {
    const base = pos.length / 3;
    for (let i = 0; i <= U; i++) {
      const u = i / U;
      const w = wMax * Math.pow(Math.sin(Math.PI * Math.min(0.999, u * 0.92 + 0.04)), 0.7) * (1 - 0.25 * u);
      for (let j = 0; j <= V; j++) {
        const vv = (j / V) * 2 - 1;
        const cup = 0.022 * (1 - vv * vv) * Math.sin(Math.PI * u) * (layer ? 1 : 0.92);
        const p = dir.clone().multiplyScalar(u * len).addScaledVector(across, vv * w).addScaledVector(cupN, -cup + (layer ? 0.002 : 0));
        pos.push(p.x, p.y, p.z);
        const edge = Math.max(Math.abs(vv), u) > 0.9;
        const c = layer ? (edge ? rim : inner) : edge ? rim : outer;
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
      const a = base + i * (V + 1) + j, b = a + 1, c = a + V + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fur look: soft sheen at grazing angles plus a little detail noise stuck to the body. */
function furMaterial(noise: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0,
    sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.62, 0.56, 0.48),
  });
  if (noise) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFurNoise = { value: noise };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBindPos;\nvarying vec3 vBindN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBindPos = position;\nvBindN = normal;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uFurNoise;\nvarying vec3 vBindPos;\nvarying vec3 vBindN;")
        .replace("#include <color_fragment>", `#include <color_fragment>
{
  // hair runs head-to-tail: stretch the noise along z
  vec3 w = abs(normalize(vBindN)); w /= (w.x + w.y + w.z);
  float a = texture2D(uFurNoise, vec2(vBindPos.z * 9.0, vBindPos.y * 55.0)).r;
  float b = texture2D(uFurNoise, vec2(vBindPos.z * 9.0, vBindPos.x * 55.0)).g;
  float c = texture2D(uFurNoise, vec2(vBindPos.x * 30.0, vBindPos.y * 30.0)).b;
  float n = a * w.x + b * w.y + c * w.z;
  diffuseColor.rgb *= 0.86 + 0.28 * n;
}`);
    };
  }
  return m;
}

export function buildDeerAsset(noise: THREE.Texture | null): DeerAsset {
  const min: Vec = [-0.26, -0.02, -0.82], max: Vec = [0.26, 1.5, 1.1];
  const field = new ShapeField(BODY, min, max, 0.06);
  const raw = surfaceNets(field, min, max, 0.0105);
  const nVert = raw.positions.length / 3;
  const boneNames = JOINTS.map((j) => j.name);
  const boneIndex = new Map(boneNames.map((n, i) => [n, i]));
  const skinIndex = new Uint16Array(nVert * 4);
  const skinWeight = new Float32Array(nVert * 4);
  const colors = new Float32Array(nVert * 3);
  const tmp = new THREE.Color();
  const acc = new Float32Array(boneNames.length);
  for (let v = 0; v < nVert; v++) {
    const x = raw.positions[v * 3], y = raw.positions[v * 3 + 1], z = raw.positions[v * 3 + 2];
    acc.fill(0);
    let bestTag = "chest", bestD = Infinity;
    field.each(x, y, z, (p, d) => {
      acc[boneIndex.get(p.bone)!] += Math.exp(-Math.max(0, d) / 0.016);
      if (d < bestD) { bestD = d; bestTag = p.tag; }
    });
    // top four bones
    const order = Array.from(acc.keys()).sort((a, b) => acc[b] - acc[a]).slice(0, 4);
    const sum = order.reduce((s, i) => s + acc[i], 0) || 1;
    order.forEach((bi, k) => { skinIndex[v * 4 + k] = bi; skinWeight[v * 4 + k] = acc[bi] / sum; });
    const n: Vec = [raw.normals[v * 3], raw.normals[v * 3 + 1], raw.normals[v * 3 + 2]];
    const c = coat([x, y, z], n, bestTag);
    tmp.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    colors[v * 3] = tmp.r; colors[v * 3 + 1] = tmp.g; colors[v * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(raw.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(raw.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  geo.computeBoundingSphere();

  const earGeo = earGeometry(1);
  return {
    geometry: geo,
    material: furMaterial(noise),
    earGeometry: earGeo,
    earMaterial: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    eyeGeometry: new THREE.SphereGeometry(0.0185, 16, 12),
    eyeMaterial: new THREE.MeshPhysicalMaterial({ color: "#0d0a08", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    boneNames,
  };
}

export type DeerRig = {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone>;
};

/** One deer instance: its own skeleton, sharing the asset's geometry and materials. */
export function makeRig(asset: DeerAsset): DeerRig {
  const bones: Record<string, THREE.Bone> = {};
  for (const j of JOINTS) {
    const b = new THREE.Bone();
    b.name = j.name;
    const pp = j.parent ? JOINT_POS[j.parent] : [0, 0, 0];
    b.position.set(j.p[0] - pp[0], j.p[1] - pp[1], j.p[2] - pp[2]);
    bones[j.name] = b;
    if (j.parent) bones[j.parent].add(b);
  }
  const mesh = new THREE.SkinnedMesh(asset.geometry, asset.material);
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(asset.boneNames.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  // ears (mirrored for the right side) and eyes ride on their bones
  for (const side of [1, -1] as const) {
    const ear = new THREE.Mesh(asset.earGeometry, asset.earMaterial);
    if (side === -1) ear.scale.x = -1;
    ear.castShadow = true;
    bones[side === 1 ? "earL" : "earR"].add(ear);
    const eye = new THREE.Mesh(asset.eyeGeometry, asset.eyeMaterial);
    const hp = JOINT_POS.head;
    eye.position.set(EYE_L[0] * side - hp[0], EYE_L[1] - hp[1], EYE_L[2] - hp[2]);
    bones.head.add(eye);
  }
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, bones };
}
