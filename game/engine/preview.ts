// Developer previews of single models on a plain background (used by /game/debug?show=...).
import * as THREE from "three";
import { foliageAtlas, barkTexture } from "../world/foliageTextures";
import { makeTree, type Species, type BarkKind } from "../world/treeGen";
import { barkMaterial, foliageMaterial } from "../world/vegMaterials";
import { sunDirection } from "../world/sky";
import { buildDeerAsset, makeRig } from "../deer/model";
import { buildAntlers, antlerMaterial } from "../deer/antlers";
import { noiseTexture } from "../world/textures";
import { DeerAnimator, type AnimInput } from "../deer/anim";

export function mountPreview(el: HTMLElement, what: string) {
  const w = el.clientWidth || 1024, h = window.innerHeight || 768;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9fb3c8");
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.86, 0.68), 3.2);
  sun.position.copy(sunDirection(222, 13)).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 200 });
  scene.add(sun, new THREE.HemisphereLight(new THREE.Color(0.62, 0.72, 0.92), new THREE.Color(0.32, 0.27, 0.2), 0.9));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: "#8a7448" }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);

  if (what === "trees") {
    const atlas = foliageAtlas();
    const leaf = foliageMaterial(atlas);
    const barks = new Map<BarkKind, THREE.Material>();
    const list: Species[] = ["spruce", "fir", "whitepine", "cedar", "tamarack", "maple", "birch", "oak", "beech", "sapling", "dogwood", "alder", "sumac", "juniper"];
    const heights: Record<string, number> = { spruce: 16, fir: 12, whitepine: 26, cedar: 10, tamarack: 15, maple: 19, birch: 16, oak: 17, beech: 10, sapling: 4, dogwood: 2, alder: 3.5, sumac: 3, juniper: 1.2 };
    let x = -48;
    for (const sp of list) {
      const m = makeTree(sp, 7919 * (list.indexOf(sp) + 1), heights[sp]);
      if (!barks.has(m.bark)) barks.set(m.bark, barkMaterial(barkTexture(m.bark)));
      const b = new THREE.Mesh(m.barkGeo, barks.get(m.bark)!);
      const l = new THREE.Mesh(m.leafGeo, leaf);
      for (const o of [b, l]) { o.position.x = x; o.castShadow = true; o.receiveShadow = true; scene.add(o); }
      x += Math.max(4, m.radius * 2 + 2);
    }
    cam.position.set(0, 9, 62);
    cam.lookAt(0, 9, 0);
  }
  if (what.startsWith("deer")) {
    const t0 = performance.now();
    const asset = buildDeerAsset(noiseTexture(256));
    console.log(`[g] deer mesh ${asset.geometry.getAttribute("position").count} verts, ${(asset.geometry.index!.count / 3) | 0} tris, ${(performance.now() - t0).toFixed(0)} ms`);
    const view = what.split(":")[1] ?? "side";
    const racks = [{ points: 8, left: 4, right: 4, size: 0.95 }, { points: 10, left: 5, right: 5, size: 1.05 }, { points: 6, left: 3, right: 3, size: 0.8 }];
    const gaits: Record<string, number> = { walk: 1.4, trot: 3.6, run: 11 };
    if (view in gaits || view === "feed" || view === "dead" || view === "flag") {
      // a strip of deer at successive moments of one stride
      const N = 6;
      for (let i = 0; i < N; i++) {
        const rig = makeRig(asset);
        rig.bones.head.add(new THREE.Mesh(buildAntlers(racks[0], 11).geometry, antlerMaterial()));
        const an = new DeerAnimator(rig);
        const inp: AnimInput = { speed: gaits[view] ?? 0, head: view === "feed" ? "feed" : view === "run" ? "relaxed" : "cruise", tail: view === "flag" || view === "run" ? "flag" : "down", lookYaw: 0, hunch: 0 };
        if (view === "dead") { an.death = (i + 1) / N; an.deathSide = 1; }
        for (let k = 0; k < 120; k++) an.update(1 / 60, inp);
        an.phase = i / N;
        an.update(0.0001, inp);
        rig.root.rotation.y = Math.PI / 2;
        rig.root.position.set(((i % 3) - 1) * 2.3, 0, i < 3 ? -2.5 : 1);
        scene.add(rig.root);
      }
      cam.position.set(0, 1.3, 7.5); cam.lookAt(0, 0.7, 0);
      ground.material.color.set("#7d6a48");
      renderer.render(scene, cam);
      return;
    }
    const n = view === "row" ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const rig = makeRig(asset);
      const ant = buildAntlers(racks[i], 11 + i);
      rig.bones.head.add(new THREE.Mesh(ant.geometry, antlerMaterial()));
      rig.root.position.x = (i - (n - 1) / 2) * 2.4;
      rig.root.rotation.y = view === "front" ? 0 : view === "quarter" ? Math.PI * 0.3 : Math.PI / 2;
      scene.add(rig.root);
    }
    if (view === "row") { cam.position.set(0, 1.2, 8); cam.lookAt(0, 0.8, 0); }
    else if (view === "front") { cam.position.set(0, 1.1, 3.2); cam.lookAt(0, 0.95, 0); }
    else if (view === "head") { cam.position.set(0.9, 1.45, 1.3); cam.lookAt(0.9, 1.4, 0); }
    else { cam.position.set(0, 0.95, 3.6); cam.lookAt(0, 0.75, 0); }
    ground.material.color.set("#7d6a48");
  }
  renderer.render(scene, cam);
}
