// An old split-rail cedar "snake" fence along the hedgerow: zig-zag panels of stacked rails,
// weathered silver-grey, a few rails fallen. A handy range reference at ~480 m.
import * as THREE from "three";
import { HEDGE } from "./layout";
import { mulberry32 } from "./noise";

export function buildFence(heightAt: (x: number, z: number) => number): THREE.InstancedMesh {
  const rnd = mulberry32(777);
  const PANEL = 3.3, ZIG = 0.55, RAILS = 6;
  const corners: THREE.Vector3[][] = [];
  for (const line of HEDGE) {
    const pts: THREE.Vector3[] = [];
    let flip = 1;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / PANEL));
      const px = -(bz - az) / L, pz = (bx - ax) / L;
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t + px * ZIG * flip, z = az + (bz - az) * t + pz * ZIG * flip;
        pts.push(new THREE.Vector3(x, heightAt(x, z), z));
        flip = -flip;
      }
    }
    corners.push(pts);
  }
  const count = corners.reduce((s, p) => s + Math.max(0, p.length - 1), 0) * RAILS;
  // a split rail: roughly triangular cross-section, ~12 cm across
  const geo = new THREE.CylinderGeometry(0.06, 0.07, 1, 3, 1);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (const pts of corners) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = b.clone().sub(a);
      const len = dir.length() + 0.5; // rails overlap at the corners
      const yaw = Math.atan2(-dir.z, dir.x);
      for (let r = 0; r < RAILS; r++) {
        const fallen = rnd() < 0.12;
        if (fallen && r > 2) continue; // top rails gone in places
        const h = fallen ? 0.08 : 0.18 + r * 0.21 + (rnd() - 0.5) * 0.05;
        p.copy(a).lerp(b, 0.5);
        p.y = heightAt(p.x, p.z) + h + (r % 2 ? 0.04 : 0);
        q.setFromEuler(new THREE.Euler(rnd() * Math.PI, yaw + (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.06 + (fallen ? (rnd() - 0.5) * 0.4 : 0), "YXZ"));
        s.set(len, 0.9 + rnd() * 0.3, 0.9 + rnd() * 0.3);
        m4.compose(p, q, s);
        mesh.setMatrixAt(n, m4);
        const g = 0.5 + rnd() * 0.12;
        col.setRGB(g, g * 0.97, g * 0.92, THREE.SRGBColorSpace);
        mesh.setColorAt(n, col);
        n++;
      }
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
