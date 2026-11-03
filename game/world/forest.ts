// Places every tree and shrub around the field and draws each one either as a full 3D
// model (close, or anywhere the scope is looking) or as a flat camera-facing impostor.
// The camera never moves, so "close" is measured as distance ÷ magnification.
import * as THREE from "three";
import { ISLANDS, sampleGroundFast, type Ground, STAND } from "./layout";
import { hash2, mulberry32, smoothstep } from "./noise";
import { barkTexture } from "./foliageTextures";
import type { Photos } from "./photoTextures";
import { makeTree, type Species, type TreeModel, type BarkKind } from "./treeGen";
import {
  bakeAlbedoMaterial, bakeNormalMaterial, barkMaterial, foliageDepthMaterial, foliageMaterial,
  impostorDepthMaterial, impostorMaterial, type BarkLook,
} from "./vegMaterials";

type SpeciesInfo = { h: [number, number]; variants: number };
const SPECIES: Record<Species, SpeciesInfo> = {
  spruce: { h: [12, 20], variants: 3 },
  fir: { h: [9, 15], variants: 2 },
  whitepine: { h: [22, 31], variants: 3 },
  cedar: { h: [7, 12], variants: 2 },
  tamarack: { h: [12, 18], variants: 2 },
  maple: { h: [15, 23], variants: 3 },
  birch: { h: [13, 19], variants: 2 },
  oak: { h: [14, 21], variants: 2 },
  beech: { h: [8, 13], variants: 2 },
  sapling: { h: [2.5, 5], variants: 2 },
  juniper: { h: [0.9, 1.5], variants: 1 },
  dogwood: { h: [1.6, 2.6], variants: 2 },
  alder: { h: [2.5, 4.5], variants: 2 },
  sumac: { h: [2, 3.5], variants: 1 },
};

/** Pick a species for a spot. */
function chooseSpecies(r: number, g: Ground, x: number, z: number): Species | null {
  const depth = -g.edge; // metres into the bush
  const wet = g.swale;
  if (g.hedge > 0.3) {
    if (r < 0.28) return "maple";
    if (r < 0.36) return "oak";
    if (r < 0.46) return "sapling";
    if (r < 0.62) return "dogwood";
    if (r < 0.72) return "sumac";
    if (r < 0.8) return "juniper";
    return null;
  }
  if (wet > 0.3) {
    if (r < 0.5) return "alder";
    if (r < 0.62) return "dogwood";
    if (r < 0.645) return "tamarack";
    if (r < 0.67) return "cedar";
    return null;
  }
  // field-edge fringe: shrubs and young conifers
  if (depth < 7) {
    if (r < 0.2) return "sapling";
    if (r < 0.36) return "dogwood";
    if (r < 0.44) return "sumac";
    if (r < 0.5) return "juniper";
    if (r < 0.62) return "fir";
    if (r < 0.72) return "spruce";
    if (r < 0.82) return "birch";
    if (r < 0.9) return "beech";
    return "maple";
  }
  // patches: some stands are mostly conifer, some mostly hardwood
  const conifer = 0.5 + 0.35 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 - 0.4);
  if (r < conifer) {
    const q = r / conifer;
    if (q < 0.42) return "spruce";
    if (q < 0.68) return "fir";
    if (q < 0.88) return "whitepine";
    if (q < 0.985) return "cedar";
    return "tamarack";
  }
  const q = (r - conifer) / (1 - conifer);
  if (q < 0.45) return "maple";
  if (q < 0.65) return "oak";
  if (q < 0.82) return "birch";
  return "beech";
}

type Inst = { model: number; x: number; y: number; z: number; s: number; rot: number; dist: number; azim: number; shade: number; depth: number };

const LOD_NEAR = 75; // m (after dividing by magnification): closer than this gets the full model

export class Forest {
  readonly group = new THREE.Group();
  models: TreeModel[] = [];
  private instances: Inst[] = [];
  private barkMeshes: THREE.InstancedMesh[] = [];
  private leafMeshes: THREE.InstancedMesh[] = [];
  private impostors!: THREE.InstancedMesh;
  /** trunks bullets can hit: [x, z, radius] near the field */
  trunks: [number, number, number][] = [];

  constructor(private renderer: THREE.WebGLRenderer, private heightAt: (x: number, z: number) => number) {}

  async build(atlas: THREE.Texture, progress: (f: number) => void, photos: Photos | null = null) {
    const T = (label: string) => { if (location.search.includes("debug")) console.log(`[t]   forest ${label}: ${(performance.now() - t0).toFixed(0)} ms`); };
    const t0 = performance.now();
    // photo bark where we have it (birch stays drawn: its white bark is distinctive enough)
    const barks = new Map<BarkKind, BarkLook>();
    const c = (hex: string) => new THREE.Color(hex);
    for (const k of ["maple", "birch", "pine", "spruce", "oak"] as BarkKind[]) barks.set(k, { map: barkTexture(k), color: c("#ffffff") });
    if (photos) {
      barks.set("maple", { map: photos.barkHw, color: c("#b8b4ae") });
      barks.set("oak", { map: photos.barkHw, color: c("#9a948c") });
      barks.set("pine", { map: photos.barkPine, normal: photos.barkPineN, color: c("#ffffff") });
      barks.set("spruce", { map: photos.barkPine, normal: photos.barkPineN, color: c("#a89c94") });
    }

    // 1. models
    const modelIndex = new Map<Species, number[]>();
    let seed = 1;
    for (const sp of Object.keys(SPECIES) as Species[]) {
      const list: number[] = [];
      const info = SPECIES[sp];
      for (let v = 0; v < info.variants; v++) {
        const h = (info.h[0] + info.h[1]) / 2;
        list.push(this.models.length);
        this.models.push(makeTree(sp, seed++ * 7919, h));
      }
      modelIndex.set(sp, list);
    }
    progress(0.3);
    T("models");
    await new Promise((r) => setTimeout(r, 0));

    // 2. placement on a jittered grid, denser near the field edge where it can be seen
    const g: Ground = { h: 0, edge: 0, open: 0, tall: 0, hedge: 0, swale: 0 };
    const ANG = (60 * Math.PI) / 180;
    const place = (x: number, z: number, rnd: number, spacing: number) => {
      const r = Math.hypot(x - STAND.x, z - STAND.z);
      if (r < 9) return;
      const azim = Math.atan2(x, -z);
      if (Math.abs(azim) > ANG) return;
      sampleGroundFast(x, z, g);
      const inHedge = g.hedge > 0.3, inSwale = g.swale > 0.3;
      const forest = g.edge < 1.5;
      if (!forest && !inHedge && !inSwale) return;
      // keep a clear shooting lane in front of the stand (low shrubs are fine)
      const sp0 = chooseSpecies(rnd, g, x, z);
      const lowShrub = sp0 === "juniper" || sp0 === "dogwood" || sp0 === "sumac";
      if (r < 55 && Math.abs(azim) < 0.95 && !lowShrub) return;
      if (r < 25 && Math.abs(azim) < 0.95) return;
      // only rows near the edge are visible; deep bush is thinned out
      const depth = -g.edge;
      if (depth > 55 && hash2(Math.round(x), Math.round(z), 5) > (spacing > 6 ? 1 : 0.5)) return;
      const sp = sp0;
      if (!sp) return;
      const list = modelIndex.get(sp)!;
      const model = list[Math.floor(hash2(Math.round(x * 3), Math.round(z * 3), 9) * list.length)];
      const info = SPECIES[sp];
      const want = info.h[0] + (info.h[1] - info.h[0]) * hash2(Math.round(x), Math.round(z), 13);
      // trees just inside the edge are a bit shorter (more light, younger)
      const edgeK = depth < 10 ? 0.75 + 0.025 * depth : 1;
      const s = (want / this.models[model].height) * edgeK;
      const y = this.heightAt(x, z) - 0.15;
      const shade = 1 - 0.5 * smoothstep(3, 40, depth); // darker deeper in the bush
      this.instances.push({ model, x, y, z, s, rot: hash2(Math.round(x * 7), Math.round(z * 7), 3) * Math.PI * 2, dist: r, azim, shade, depth: inHedge || inSwale ? 0 : depth });
      if (r < 1300 && (sp !== "dogwood" && sp !== "sumac" && sp !== "juniper" && sp !== "alder")) {
        this.trunks.push([x, z, Math.max(0.12, this.models[model].height * s * 0.018)]);
      }
    };
    const cell = (cx: number, cz: number, spacing: number) => {
      const jx = hash2(cx, cz, 1), jz = hash2(cx, cz, 2), r = hash2(cx, cz, 4);
      place((cx + jx) * spacing, (cz + jz) * spacing, r, spacing);
    };
    // near band (to 1100 m): 4.2 m spacing; far slope behind the field: 8 m
    const S1 = 4.2;
    for (let cz = Math.floor(-1150 / S1); cz < Math.ceil(12 / S1); cz++)
      for (let cx = Math.floor(-1000 / S1); cx < Math.ceil(1000 / S1); cx++) {
        const x = cx * S1, z = cz * S1;
        if (Math.hypot(x, z) > 1150) continue;
        cell(cx, cz, S1);
      }
    progress(0.6);
    T("near placement");
    await new Promise((r) => setTimeout(r, 0));
    const S2 = 8;
    for (let cz = Math.floor(-1750 / S2); cz < 0; cz++)
      for (let cx = Math.floor(-1600 / S2); cx < Math.ceil(1600 / S2); cx++) {
        const x = cx * S2, z = cz * S2;
        const r = Math.hypot(x, z);
        if (r <= 1150 || r > 1750) continue;
        cell(cx, cz, S2);
      }
    // a dense fringe of shrubs and young trees right along the edge of the bush
    const S3 = 2.3;
    for (let cz = Math.floor(-1150 / S3); cz < Math.ceil(10 / S3); cz++)
      for (let cx = Math.floor(-1000 / S3); cx < Math.ceil(1000 / S3); cx++) {
        const x = (cx + hash2(cx, cz, 31)) * S3, z = (cz + hash2(cx, cz, 32)) * S3;
        const r = Math.hypot(x, z);
        if (r > 1100 || r < 30) continue;
        const azim = Math.atan2(x, -z);
        if (Math.abs(azim) > ANG) continue;
        sampleGroundFast(x, z, g);
        if (g.edge < -6 || g.edge > 0.5 || g.hedge > 0.3 || g.swale > 0.3) continue;
        if (r < 55 && Math.abs(azim) < 0.95) continue;
        const h = hash2(cx, cz, 33);
        const sp: Species = h < 0.3 ? "dogwood" : h < 0.5 ? "sapling" : h < 0.62 ? "alder" : h < 0.72 ? "sumac" : h < 0.8 ? "juniper" : h < 0.9 ? "fir" : "beech";
        const list = modelIndex.get(sp)!;
        const model = list[Math.floor(hash2(cx, cz, 34) * list.length)];
        const info = SPECIES[sp];
        const want = info.h[0] + (info.h[1] - info.h[0]) * hash2(cx, cz, 35) * (sp === "fir" || sp === "beech" ? 0.6 : 1);
        this.instances.push({ model, x, y: this.heightAt(x, z) - 0.1, z, s: want / this.models[model].height, rot: hash2(cx, cz, 36) * 6.28, dist: r, azim, shade: 0.95, depth: 0 });
      }
    // islands get a few big pines to stand out
    for (const [ix, iz, rad] of ISLANDS) {
      const rnd = mulberry32(Math.round(ix * 13 + iz));
      for (let k = 0; k < Math.round(rad / 9); k++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * rad * 0.6;
        const x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr;
        const list = modelIndex.get("whitepine")!;
        const model = list[k % list.length];
        this.instances.push({ model, x, y: this.heightAt(x, z) - 0.2, z, s: (24 + rnd() * 6) / this.models[model].height, rot: rnd() * 6.28, dist: Math.hypot(x, z), azim: Math.atan2(x, -z), shade: 1, depth: 0 });
      }
    }
    progress(0.7);
    T("all placement");
    await new Promise((r) => setTimeout(r, 0));

    // 3. impostors
    const { albedo, normals, cells } = this.bakeImpostors(atlas, barks);
    progress(0.9);
    T("impostors");

    // 4. meshes
    const leafMat = foliageMaterial(atlas);
    const leafDepth = foliageDepthMaterial(atlas);
    const barkMats = new Map<BarkKind, THREE.Material>();
    barks.forEach((t, k) => barkMats.set(k, barkMaterial(t)));
    const counts = new Array(this.models.length).fill(0);
    for (const i of this.instances) counts[i.model]++;
    this.models.forEach((m, k) => {
      const cap = Math.min(counts[k], 900);
      const bark = new THREE.InstancedMesh(m.barkGeo, barkMats.get(m.bark)!, Math.max(1, cap));
      const leaf = new THREE.InstancedMesh(m.leafGeo, leafMat, Math.max(1, cap));
      leaf.customDepthMaterial = leafDepth;
      for (const mesh of [bark, leaf]) {
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
      }
      leaf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
      bark.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
      this.barkMeshes.push(bark);
      this.leafMeshes.push(leaf);
    });

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const n = this.instances.length;
    const imp = new THREE.InstancedMesh(quad, impostorMaterial(albedo, normals), n);
    imp.customDepthMaterial = impostorDepthMaterial(albedo);
    const aCell = new Float32Array(n * 4), aSize = new Float32Array(n * 3);
    imp.geometry.setAttribute("aCell", new THREE.InstancedBufferAttribute(aCell, 4));
    imp.geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(aSize, 3));
    imp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    imp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    imp.count = 0;
    imp.castShadow = true;
    imp.receiveShadow = true;
    imp.frustumCulled = false;
    this.impostors = imp;
    this.impCells = cells;
    this.group.add(imp);
    progress(1);
  }

  private impCells: { uv: [number, number, number, number]; w: number; h: number; y0: number }[] = [];

  /** Render every model once, from the south, into albedo + normal atlases. */
  private bakeImpostors(atlas: THREE.Texture, barks: Map<BarkKind, BarkLook>) {
    const W = 2048, H = 2048, CELL_H = 384;
    const mk = (srgb: boolean) => {
      const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
      return rt;
    };
    const albedoRT = mk(true), normalRT = mk(false);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);
    const cells: { uv: [number, number, number, number]; w: number; h: number; y0: number }[] = [];
    // shelf packing
    let px = 0, py = 0;
    const layout: { x: number; y: number; w: number; h: number; box: THREE.Box3 }[] = [];
    for (const m of this.models) {
      const box = new THREE.Box3().setFromBufferAttribute(m.leafGeo.getAttribute("position") as THREE.BufferAttribute);
      box.union(new THREE.Box3().setFromBufferAttribute(m.barkGeo.getAttribute("position") as THREE.BufferAttribute));
      const half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.02;
      box.min.x = -half; box.max.x = half;
      const hh = box.max.y - Math.min(0, box.min.y);
      const cw = Math.min(W, Math.ceil((CELL_H * (2 * half)) / hh));
      if (px + cw > W) { px = 0; py += CELL_H; }
      layout.push({ x: px, y: py, w: cw, h: CELL_H, box });
      px += cw + 2;
    }
    const rd = this.renderer;
    const prevTone = rd.toneMapping;
    rd.toneMapping = THREE.NoToneMapping;
    const prevClear = rd.getClearColor(new THREE.Color()), prevAlpha = rd.getClearAlpha();
    for (const pass of ["albedo", "normal"] as const) {
      const rt = pass === "albedo" ? albedoRT : normalRT;
      rt.scissorTest = false;
      rt.viewport.set(0, 0, W, H);
      rd.setRenderTarget(rt);
      if (pass === "albedo") rd.setClearColor(new THREE.Color(0.3, 0.27, 0.22), 0); else rd.setClearColor(new THREE.Color(0.5, 0.5, 1.0), 0);
      rd.clear();
      this.models.forEach((m, k) => {
        const L = layout[k];
        const bl = barks.get(m.bark)!;
        const bark = new THREE.Mesh(m.barkGeo, pass === "albedo" ? bakeAlbedoMaterial(bl.map, false, bl.color) : bakeNormalMaterial(bl.map, false));
        const leaf = new THREE.Mesh(m.leafGeo, pass === "albedo" ? bakeAlbedoMaterial(atlas, true) : bakeNormalMaterial(atlas, true));
        scene.add(bark, leaf);
        const y0 = Math.min(0, L.box.min.y);
        cam.left = L.box.min.x; cam.right = L.box.max.x; cam.bottom = y0; cam.top = L.box.max.y;
        cam.updateProjectionMatrix();
        // render targets use their own viewport/scissor
        rt.viewport.set(L.x, L.y, L.w, L.h);
        rt.scissor.set(L.x, L.y, L.w, L.h);
        rt.scissorTest = true;
        rd.setRenderTarget(rt);
        rd.render(scene, cam);
        scene.remove(bark, leaf);
        (bark.material as THREE.Material).dispose();
        (leaf.material as THREE.Material).dispose();
        if (pass === "albedo") cells.push({
          uv: [L.x / W, L.y / H, (L.x + L.w) / W, (L.y + L.h) / H],
          w: L.box.max.x - L.box.min.x, h: L.box.max.y - y0, y0,
        });
      });
      rt.scissorTest = false;
      rt.viewport.set(0, 0, W, H);
    }
    rd.setScissorTest(false);
    rd.setRenderTarget(null);
    rd.toneMapping = prevTone;
    rd.setClearColor(prevClear, prevAlpha);
    return { albedo: albedoRT.texture, normals: normalRT.texture, cells };
  }

  /**
   * Choose full models vs impostors for the current view. Cheap enough to run every frame,
   * but skipped unless the view (direction or magnification) has changed.
   */
  update(yaw: number, halfH: number, magnification: number) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    for (const mm of this.barkMeshes) mm.count = 0;
    for (const mm of this.leafMeshes) mm.count = 0;
    let ni = 0;
    const imp = this.impostors;
    const aCell = imp.geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute;
    const aSize = imp.geometry.getAttribute("aSize") as THREE.InstancedBufferAttribute;
    const up = new THREE.Vector3(0, 1, 0);
    for (const t of this.instances) {
      // horizontal visibility (trees are tall, so pitch is checked loosely)
      let da = t.azim - yaw;
      if (Math.abs(da) > halfH + Math.atan2(this.models[t.model].radius * t.s, t.dist)) continue;
      const eff = t.dist / magnification;
      pos.set(t.x, t.y, t.z);
      sc.setScalar(t.s);
      col.setScalar(t.shade);
      // full models only for trees that can actually be seen: near the edge of the cover
      if (eff < LOD_NEAR && t.depth < 16) {
        const bark = this.barkMeshes[t.model], leaf = this.leafMeshes[t.model];
        if (bark.count < bark.instanceMatrix.count) {
          q.setFromAxisAngle(up, t.rot);
          m4.compose(pos, q, sc);
          bark.setMatrixAt(bark.count, m4); bark.setColorAt(bark.count, col); bark.count++;
          leaf.setMatrixAt(leaf.count, m4); leaf.setColorAt(leaf.count, col); leaf.count++;
          continue;
        }
      }
      q.identity();
      m4.compose(pos, q, sc);
      imp.setMatrixAt(ni, m4);
      imp.setColorAt(ni, col);
      const c = this.impCells[t.model];
      aCell.setXYZW(ni, c.uv[0], c.uv[1], c.uv[2], c.uv[3]);
      aSize.setXYZ(ni, c.w, c.h, c.y0);
      ni++;
      da = 0;
    }
    imp.count = ni;
    imp.instanceMatrix.needsUpdate = true;
    if (imp.instanceColor) imp.instanceColor.needsUpdate = true;
    aCell.needsUpdate = true;
    aSize.needsUpdate = true;
    for (const mm of [...this.barkMeshes, ...this.leafMeshes]) {
      mm.instanceMatrix.needsUpdate = true;
      if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
    }
  }

  get count() { return this.instances.length; }
}
