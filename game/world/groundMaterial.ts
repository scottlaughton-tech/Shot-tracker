// Ground shading: blends old-field grass, hay stubble, brush and forest floor using the
// per-vertex masks from the terrain builder, with noise at three scales to break up tiling.
import * as THREE from "three";

export function groundMaterial(noise: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const uniforms = {
    uNoise: { value: noise },
    cTall: { value: new THREE.Color("#8a7448") },
    cTall2: { value: new THREE.Color("#b49a64") },
    cHay: { value: new THREE.Color("#8f8a58") },
    cHay2: { value: new THREE.Color("#a59a68") },
    cBrush: { value: new THREE.Color("#5b4a33") },
    cFloor: { value: new THREE.Color("#4a3a28") },
    cFloor2: { value: new THREE.Color("#6e5236") },
    cCanopy: { value: new THREE.Color("#3a3d2e") },
    cCanopy2: { value: new THREE.Color("#5f574a") },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 aMask;
varying vec4 vMask;
varying vec3 vWorldPos;`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
vMask = aMask;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uNoise;
uniform vec3 cTall, cTall2, cHay, cHay2, cBrush, cFloor, cFloor2, cCanopy, cCanopy2;
varying vec4 vMask;
varying vec3 vWorldPos;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float dist = length(p);
  vec4 nFine = texture2D(uNoise, p * 0.37);
  vec4 nMid = texture2D(uNoise, p * 0.045);
  vec4 nBig = texture2D(uNoise, p * 0.0042);
  float open = vMask.x, tall = vMask.y, brush = vMask.z, deep = vMask.w;
  // streaky blades in the near field
  float streak = texture2D(uNoise, vec2(p.x * 1.9, p.y * 0.35)).r;
  vec3 tallC = mix(cTall, cTall2, smoothstep(0.25, 0.75, nMid.g * 0.7 + streak * 0.45));
  tallC *= 0.82 + 0.3 * nFine.b;
  vec3 hayC = mix(cHay, cHay2, smoothstep(0.3, 0.8, nMid.r));
  hayC *= 0.85 + 0.22 * nFine.r;
  // mowing rows in the hay
  hayC *= 0.93 + 0.07 * sin(p.x * 0.9 + nBig.g * 6.0);
  vec3 fieldC = mix(hayC, tallC, tall);
  fieldC = mix(fieldC, fieldC * vec3(0.82, 0.86, 0.75), smoothstep(0.55, 0.8, nBig.b));
  vec3 floorC = mix(cFloor, cFloor2, smoothstep(0.3, 0.7, nFine.g)) * (0.75 + 0.35 * nMid.a);
  vec3 c = mix(floorC, fieldC, open);
  c = mix(c, cBrush * (0.8 + 0.4 * nFine.a), brush * 0.85);
  // far away the ground is all forest canopy seen from the side
  float canopy = smoothstep(1500.0, 2600.0, dist);
  vec3 canC = mix(cCanopy, cCanopy2, smoothstep(0.35, 0.7, nBig.r)) * (0.8 + 0.3 * nMid.b);
  c = mix(c, canC, canopy);
  diffuseColor.rgb = c;
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = 0.9 + 0.1 * vMask.x;`);
  };
  return mat;
}
