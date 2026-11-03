// Materials for trees, shrubs and grass: bark, foliage cards (wind sway, no back-face
// darkening), and camera-facing impostors with baked albedo + normals for far trees.
import * as THREE from "three";

export type WindUniforms = { uTime: { value: number }; uWind: { value: number } };
export const wind: WindUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

const SWAY_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 swayBase = instanceMatrix[3].xyz;
#else
  vec3 swayBase = vec3(0.0);
#endif
  float swayPh = uTime * 1.7 + swayBase.x * 0.13 + swayBase.z * 0.071 + position.y * 0.35;
  float gust = 0.6 + 0.4 * sin(uTime * 0.31 + swayBase.x * 0.004);
  transformed.x += aSway * uWind * gust * (sin(swayPh) * 0.10 + sin(swayPh * 2.7) * 0.035);
  transformed.z += aSway * uWind * gust * cos(swayPh * 0.83) * 0.06;
`;

export function foliageMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide,
    vertexColors: true, roughness: 0.88, metalness: 0,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY_VERT);
    // foliage normals point out of the crown; don't flip them on the back of a card
    sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""));
  };
  m.customProgramCacheKey = () => "foliage-v1";
  return m;
}

/** Depth material for foliage shadows (alpha-tested cards). */
export function foliageDepthMaterial(atlas: THREE.Texture): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY_VERT);
  };
  return m;
}

export type BarkLook = { map: THREE.Texture; normal?: THREE.Texture; color: THREE.Color };

export function barkMaterial(b: BarkLook): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: b.map, normalMap: b.normal ?? null, normalScale: new THREE.Vector2(1.2, 1.2), color: b.color, roughness: 0.95, metalness: 0,
  });
}

// ---------- impostors ----------

const BILLBOARD = /* glsl */ `
attribute vec4 aCell;   // uv rect in the impostor atlas
attribute vec3 aSize;   // width, height, bottom offset (metres, before instance scale)
varying vec2 vImpUv;
varying vec3 vBillR;
varying vec3 vBillF;
`;

const BILLBOARD_POS = /* glsl */ `
  vec3 impBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float impScale = length(instanceMatrix[0].xyz);
  vec3 toCam = cameraPosition - impBase;
  toCam.y = 0.0;
  toCam = normalize(toCam);
  vec3 impRight = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 impWorld = impBase + impRight * (position.x * aSize.x * impScale) + vec3(0.0, 1.0, 0.0) * ((position.y * aSize.y + aSize.z) * impScale);
  vImpUv = vec2(mix(aCell.x, aCell.z, position.x + 0.5), mix(aCell.y, aCell.w, position.y));
  vBillR = impRight;
  vBillF = toCam;
`;

/** Far trees: one quad per tree, always facing the camera, lit with the baked normals. */
export function impostorMaterial(albedo: THREE.Texture, normals: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAlbedo = { value: albedo };
    sh.uniforms.uNormals = { value: normals };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + BILLBOARD)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + BILLBOARD_POS)
      .replace("#include <project_vertex>", `vec4 mvPosition = viewMatrix * vec4(impWorld, 1.0);
gl_Position = projectionMatrix * mvPosition;`)
      .replace("#include <worldpos_vertex>", "vec4 worldPosition = vec4(impWorld, 1.0);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uAlbedo;
uniform sampler2D uNormals;
varying vec2 vImpUv;
varying vec3 vBillR;
varying vec3 vBillF;`)
      .replace("#include <map_fragment>", `vec4 impA = texture2D(uAlbedo, vImpUv);
diffuseColor *= impA;`)
      .replace("#include <normal_fragment_maps>", `{
  vec3 nb = texture2D(uNormals, vImpUv).xyz * 2.0 - 1.0;
  vec3 wn = normalize(vBillR * nb.x + vec3(0.0, 1.0, 0.0) * nb.y + vBillF * nb.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  };
  m.customProgramCacheKey = () => "impostor-v1";
  return m;
}

export function impostorDepthMaterial(albedo: THREE.Texture): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAlbedo = { value: albedo };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + BILLBOARD)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + BILLBOARD_POS)
      .replace("#include <project_vertex>", `vec4 mvPosition = viewMatrix * vec4(impWorld, 1.0);
gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uAlbedo;\nvarying vec2 vImpUv;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (texture2D(uAlbedo, vImpUv).a < 0.5) discard;");
  };
  return m;
}

/** Bake helpers: unlit albedo, and view-space normals. */
export function bakeAlbedoMaterial(map: THREE.Texture, cards: boolean, color = new THREE.Color(1, 1, 1)): THREE.Material {
  return new THREE.MeshBasicMaterial({ map, color, vertexColors: cards, alphaTest: cards ? 0.42 : 0, side: cards ? THREE.DoubleSide : THREE.FrontSide });
}

export function bakeNormalMaterial(map: THREE.Texture, cards: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    side: cards ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(mat3(viewMatrix) * normal); // bake camera looks along -z: view space = world rotated
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D map;
varying vec3 vN;
varying vec2 vUv;
void main() {
  ${cards ? "if (texture2D(map, vUv).a < 0.42) discard;" : ""}
  vec3 n = normalize(vN);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
  });
}
