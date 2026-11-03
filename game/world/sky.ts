// Sky, sun and haze for a clear-to-partly-cloudy November afternoon near Bancroft.
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/** Sun direction for azimuth/elevation in degrees (azimuth from north, clockwise). x = east, -z = north. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export type SkySetup = {
  sky: Sky;
  clouds: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  fogColor: THREE.Color;
  update: (t: number) => void;
  /** 0 = start of the hunt, 1 = the sun is nearly down */
  setLight: (dusk: number) => void;
};

const cloudVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  if (d.y < 0.0) discard;
  // project onto a flat cloud deck: far clouds bunch up near the horizon
  vec2 uv = d.xz / (d.y + 0.08) * 1.6;
  uv += vec2(uTime * 0.004, uTime * 0.0015);
  float base = fbm(uv * 0.9);
  float detail = fbm(uv * 3.1 + 4.0);
  float c = smoothstep(0.50, 0.78, base * 0.8 + detail * 0.32);
  // thin streaky cirrus higher up
  float cirrus = smoothstep(0.55, 0.9, fbm(vec2(uv.x * 0.35, uv.y * 2.2) + 11.0)) * 0.35;
  float a = max(c, cirrus) * smoothstep(0.0, 0.12, d.y);
  // light from the sun side, darker bellies
  float toward = pow(max(dot(d, uSunDir), 0.0), 6.0);
  float thick = smoothstep(0.55, 0.95, base);
  vec3 col = mix(uLit, uShade, thick * 0.8) + toward * vec3(1.0, 0.75, 0.45) * 0.6;
  gl_FragColor = vec4(col, a * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildSky(scene: THREE.Scene, opts: { azimuth: number; elevation: number }): SkySetup {
  const sunDir = sunDirection(opts.azimuth, opts.elevation);

  const sky = new Sky();
  sky.scale.setScalar(40000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(30000, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uSunDir: { value: sunDir },
        uTime: { value: 0 },
        uLit: { value: new THREE.Color(1.0, 0.96, 0.9).multiplyScalar(1.15) },
        uShade: { value: new THREE.Color(0.55, 0.58, 0.66) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  clouds.renderOrder = -1;
  clouds.frustumCulled = false;
  scene.add(clouds);

  // Low November sun: warm, fairly strong. Sky fill is cool blue.
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.68), 3.2);
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0.62, 0.72, 0.92), new THREE.Color(0.36, 0.31, 0.24), 1.5);
  scene.add(hemi);

  const fogColor = new THREE.Color(0.68, 0.74, 0.82);
  scene.fog = new THREE.FogExp2(fogColor, 0.00022);

  return {
    sky, clouds, sun, hemi, sunDir, fogColor,
    update: (t: number) => { (clouds.material as THREE.ShaderMaterial).uniforms.uTime.value = t; },
    setLight: (dusk: number) => {
      // the sun sinks toward the treeline; light gets warmer and weaker
      const el = opts.elevation + (2.5 - opts.elevation) * dusk;
      sunDir.copy(sunDirection(opts.azimuth + 6 * dusk, el));
      u.sunPosition.value.copy(sunDir);
      (clouds.material as THREE.ShaderMaterial).uniforms.uSunDir.value = sunDir;
      sun.color.setRGB(1.0, 0.86 - 0.2 * dusk, 0.68 - 0.3 * dusk);
      sun.intensity = 3.2 * (1 - 0.55 * dusk);
      hemi.intensity = 1.5 * (1 - 0.45 * dusk);
      hemi.color.setRGB(0.62 - 0.08 * dusk, 0.72 - 0.12 * dusk, 0.92 - 0.1 * dusk);
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(fogColor).lerp(new THREE.Color(0.6, 0.55, 0.55), dusk * 0.6);
    },
  };
}
