// Ground shading: blends old-field ground, hay stubble, brush and forest floor using the
// per-vertex masks from the terrain builder. Photo textures (when loaded) give the close-up
// detail; procedural noise at large scales breaks up tiling and adds patchiness far away.
import * as THREE from "three";
import type { Photos } from "./photoTextures";

export function groundMaterial(noise: THREE.Texture, photos: Photos | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    uNoise: { value: noise },
    uFloor: { value: photos?.floor ?? blank }, uFloorN: { value: photos?.floorN ?? blank },
    uField: { value: photos?.field ?? blank },
    uGround: { value: photos?.ground ?? blank }, uGroundN: { value: photos?.groundN ?? blank },
    uPhotos: { value: photos ? 1 : 0 },
    cTall: { value: new THREE.Color("#8a7448") },
    cTall2: { value: new THREE.Color("#b49a64") },
    cHay: { value: new THREE.Color("#8f8a58") },
    cHay2: { value: new THREE.Color("#a59a68") },
    cBrush: { value: new THREE.Color("#5b4a33") },
    cFloor: { value: new THREE.Color("#4a3a28") },
    cFloor2: { value: new THREE.Color("#6e5236") },
    cCanopy: { value: new THREE.Color("#363a2c") },
    cCanopy2: { value: new THREE.Color("#5a5346") },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 aMask;
varying vec4 vMask;
varying vec3 vWorldPos;
varying vec3 vWorldN;`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
vMask = aMask;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uNoise, uFloor, uFloorN, uField, uGround, uGroundN;
uniform float uPhotos;
uniform vec3 cTall, cTall2, cHay, cHay2, cBrush, cFloor, cFloor2, cCanopy, cCanopy2;
varying vec4 vMask;
varying vec3 vWorldPos;
varying vec3 vWorldN;
vec3 gNormalOffset;
// Inigo Quilez's "texture repetition" trick: each patch of ground samples the photo at a
// different random offset, blended smoothly, so no repeating pattern shows at a distance.
vec3 noTile(sampler2D t, vec2 uv) {
  float k = texture2D(uNoise, 0.0021 * uv).x;
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia), offb = sin(vec2(3.0, 7.0) * ib);
  vec3 ca = textureGrad(t, uv + offa, dx, dy).rgb;
  vec3 cb = textureGrad(t, uv + offb, dx, dy).rgb;
  return mix(ca, cb, smoothstep(0.2, 0.8, f - 0.1 * dot(ca - cb, vec3(1.0))));
}
vec3 photo2(sampler2D t, vec2 p, float s, float mixer) {
  vec3 a = noTile(t, p * s);
  vec3 b = texture2D(t, p * s * 0.37 + 0.31).rgb;
  return mix(a, b, smoothstep(0.35, 0.65, mixer));
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float dist = length(p - cameraPosition.xz);
  vec4 nFine = texture2D(uNoise, p * 0.37);
  vec4 nMid = texture2D(uNoise, p * 0.045);
  vec4 nBig = texture2D(uNoise, p * 0.0042);
  float open = vMask.x, tall = vMask.y, brush = vMask.z, deep = vMask.w;
  vec3 tallC, hayC, floorC;
  gNormalOffset = vec3(0.0);
  if (uPhotos > 0.5) {
    tallC = vec3(0.4); hayC = vec3(0.4); floorC = vec3(0.3);
    // only sample what this spot needs
    if (open > 0.01 && tall > 0.01) {
      // old field: dry leafy ground under the grass, warmed toward straw
      vec3 f = photo2(uField, p, 0.28, nMid.r);
      tallC = mix(f * vec3(1.2, 1.06, 0.8), vec3(0.42, 0.33, 0.2), 0.35) * mix(0.88, 1.08, nMid.g);
    }
    if (open > 0.01 && tall < 0.99) {
      // hay field: dry ground, a little greener, with mowing rows
      vec3 g = photo2(uGround, p, 0.25, nMid.b);
      // November stubble: straw and tan with grey patches, only a hint of green
      hayC = mix(g * vec3(1.12, 0.98, 0.72), vec3(0.47, 0.39, 0.25), 0.4) * mix(0.84, 1.12, nMid.r);
      hayC = mix(hayC, hayC * vec3(0.9, 0.92, 0.95), smoothstep(0.55, 0.8, nMid.a));
      // raked rows (lighter strips of cut hay) and fine stubble streaks
      float row = smoothstep(0.35, 0.9, sin(p.x * 1.15 + nBig.g * 5.0 + nMid.r * 1.5) * 0.5 + 0.5);
      hayC *= 0.86 + 0.2 * row;
      float stub = texture2D(uNoise, vec2(p.x * 4.1, p.y * 0.55)).g * 0.6 + texture2D(uNoise, vec2(p.x * 9.3, p.y * 1.1)).b * 0.4;
      hayC *= mix(1.0, 0.78 + 0.42 * stub, 1.0 - smoothstep(60.0, 260.0, dist));
    }
    if (open < 0.99 || brush > 0.01) {
      // forest floor: leaf litter
      floorC = photo2(uFloor, p, 0.33, nMid.a) * (0.72 + 0.3 * nMid.g);
    }
    // close-up bumps from the normal maps (fade out with distance)
    float nk = 1.0 - smoothstep(30.0, 140.0, dist);
    vec3 nf = texture2D(uFloorN, p * 0.33).xyz * 2.0 - 1.0;
    vec3 ng = texture2D(uGroundN, p * 0.25).xyz * 2.0 - 1.0;
    vec3 nn = mix(nf, ng, open);
    gNormalOffset = vec3(nn.x, 0.0, nn.y) * 0.6 * nk;
  } else {
    float streak = texture2D(uNoise, vec2(p.x * 1.9, p.y * 0.35)).r;
    tallC = mix(cTall, cTall2, smoothstep(0.25, 0.75, nMid.g * 0.7 + streak * 0.45)) * (0.82 + 0.3 * nFine.b);
    hayC = mix(cHay, cHay2, smoothstep(0.3, 0.8, nMid.r)) * (0.85 + 0.22 * nFine.r);
    hayC *= 0.93 + 0.07 * sin(p.x * 0.9 + nBig.g * 6.0);
    floorC = mix(cFloor, cFloor2, smoothstep(0.3, 0.7, nFine.g)) * (0.75 + 0.35 * nMid.a);
  }
  vec3 fieldC = mix(hayC, tallC, tall);
  // big patches: greyer, browner, a little green
  fieldC = mix(fieldC, fieldC * vec3(0.84, 0.88, 0.78), smoothstep(0.55, 0.8, nBig.b));
  fieldC = mix(fieldC, fieldC * vec3(1.08, 1.0, 0.9), smoothstep(0.6, 0.85, nBig.r) * 0.6);
  vec3 c = mix(floorC * mix(1.0, 0.7, deep), fieldC, open);
  c = mix(c, (uPhotos > 0.5 ? floorC * 1.05 : cBrush) * (0.8 + 0.4 * nFine.a), brush * 0.8);
  // far away the ground is all forest canopy seen from the side
  float canopy = smoothstep(1500.0, 2600.0, dist);
  vec3 canC = mix(cCanopy, cCanopy2, smoothstep(0.35, 0.7, nBig.r)) * (0.8 + 0.3 * nMid.b);
  c = mix(c, canC, canopy);
  diffuseColor.rgb = c;
}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
if (uPhotos > 0.5) {
  vec3 wn = normalize(vWorldN + gNormalOffset);
  normal = normalize(mat3(viewMatrix) * wn);
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = 0.9 + 0.1 * vMask.x;`);
  };
  mat.customProgramCacheKey = () => "ground-v3";
  return mat;
}
