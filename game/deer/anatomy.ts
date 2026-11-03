// A mature whitetail buck (about 90 kg, 1.0 m at the shoulder), in metres.
// Model space: origin on the ground under the middle of the body, +y up, +z forward (nose),
// +x = the deer's left side. Everything is the standing "bind" pose.
//
// JOINTS  - the skeleton (each joint is a bone; its parent is listed)
// BODY    - the outside shape, as shapes owned by bones (also tagged with a hit zone)
// ORGANS  - inside the body; a bullet's path through these decides the result
import type { Prim, Vec } from "./sdf";
import type { Zone } from "../scoring";

export type Joint = { name: string; parent: string | null; p: Vec };

const L = 0.104; // half the distance between left and right legs

function legs(side: 1 | -1): Joint[] {
  const s = side === 1 ? "L" : "R";
  const x = (v: number) => v * side;
  return [
    { name: `scap${s}`, parent: "chest", p: [x(0.095), 0.93, 0.36] },
    { name: `hum${s}`, parent: `scap${s}`, p: [x(0.11), 0.745, 0.425] },
    { name: `rad${s}`, parent: `hum${s}`, p: [x(L + 0.002), 0.58, 0.31] },
    { name: `canF${s}`, parent: `rad${s}`, p: [x(L), 0.33, 0.345] },
    { name: `pasF${s}`, parent: `canF${s}`, p: [x(L), 0.105, 0.36] },
    { name: `toeF${s}`, parent: `pasF${s}`, p: [x(L), 0.0, 0.415] },
    { name: `fem${s}`, parent: "pelvis", p: [x(0.1), 0.86, -0.375] },
    { name: `tib${s}`, parent: `fem${s}`, p: [x(0.118), 0.6, -0.25] },
    { name: `met${s}`, parent: `tib${s}`, p: [x(L), 0.425, -0.485] },
    { name: `pasH${s}`, parent: `met${s}`, p: [x(L), 0.108, -0.43] },
    { name: `toeH${s}`, parent: `pasH${s}`, p: [x(L), 0.0, -0.375] },
  ];
}

export const JOINTS: Joint[] = [
  { name: "root", parent: null, p: [0, 0, 0] },
  { name: "pelvis", parent: "root", p: [0, 0.92, -0.38] },
  { name: "tail", parent: "pelvis", p: [0, 0.955, -0.6] },
  { name: "spine1", parent: "pelvis", p: [0, 0.95, -0.12] },
  { name: "spine2", parent: "spine1", p: [0, 0.975, 0.14] },
  { name: "chest", parent: "spine2", p: [0, 0.98, 0.33] },
  { name: "neck1", parent: "chest", p: [0, 0.97, 0.5] },
  { name: "neck2", parent: "neck1", p: [0, 1.14, 0.635] },
  { name: "head", parent: "neck2", p: [0, 1.33, 0.765] },
  { name: "earL", parent: "head", p: [0.055, 1.435, 0.79] },
  { name: "earR", parent: "head", p: [-0.055, 1.435, 0.79] },
  ...legs(1),
  ...legs(-1),
];

const ell = (c: Vec, r: Vec, bone: string, k: number, tag: string): Prim => ({ kind: "ell", c, r, bone, k, tag });
const cone = (a: Vec, b: Vec, r1: number, r2: number, bone: string, k: number, tag: string): Prim => ({ kind: "cone", a, b, r1, r2, bone, k, tag });

function legShapes(side: 1 | -1): Prim[] {
  const s = side === 1 ? "L" : "R";
  const x = (v: number) => v * side;
  return [
    // front leg
    ell([x(0.098), 0.8, 0.375], [0.068, 0.17, 0.115], `scap${s}`, 0.06, "shoulder"),
    cone([x(0.11), 0.745, 0.425], [x(0.106), 0.58, 0.31], 0.066, 0.054, `hum${s}`, 0.05, "shoulder"),
    cone([x(0.106), 0.585, 0.315], [x(L), 0.335, 0.345], 0.05, 0.027, `rad${s}`, 0.03, "leg"),
    ell([x(L), 0.335, 0.348], [0.024, 0.032, 0.029], `rad${s}`, 0.012, "leg"),
    cone([x(L), 0.33, 0.347], [x(L), 0.11, 0.36], 0.0225, 0.0195, `canF${s}`, 0.012, "leg"),
    ell([x(L), 0.105, 0.364], [0.022, 0.026, 0.026], `canF${s}`, 0.01, "leg"),
    cone([x(L), 0.1, 0.366], [x(L), 0.035, 0.392], 0.019, 0.019, `pasF${s}`, 0.008, "leg"),
    cone([x(L), 0.04, 0.384], [x(L), 0.006, 0.43], 0.024, 0.01, `pasF${s}`, 0.006, "hoof"),
    // hind leg: big ham, gaskin, hock with the point of the heel, long cannon
    ell([x(0.098), 0.76, -0.415], [0.084, 0.2, 0.15], `fem${s}`, 0.07, "ham"),
    cone([x(0.104), 0.86, -0.375], [x(0.118), 0.605, -0.255], 0.07, 0.062, `fem${s}`, 0.05, "ham"),
    cone([x(0.116), 0.6, -0.262], [x(L), 0.43, -0.47], 0.056, 0.03, `tib${s}`, 0.035, "leg"),
    ell([x(L), 0.432, -0.49], [0.024, 0.03, 0.03], `tib${s}`, 0.012, "leg"),
    ell([x(L), 0.455, -0.525], [0.017, 0.026, 0.02], `tib${s}`, 0.012, "leg"),
    cone([x(L), 0.425, -0.485], [x(L), 0.113, -0.432], 0.025, 0.02, `met${s}`, 0.012, "leg"),
    ell([x(L), 0.108, -0.43], [0.022, 0.026, 0.026], `met${s}`, 0.01, "leg"),
    cone([x(L), 0.103, -0.428], [x(L), 0.035, -0.402], 0.019, 0.019, `pasH${s}`, 0.008, "leg"),
    cone([x(L), 0.04, -0.41], [x(L), 0.006, -0.365], 0.024, 0.01, `pasH${s}`, 0.006, "hoof"),
  ];
}

export const BODY: Prim[] = [
  // torso: deep rib cage, belly tucked up at the flank, round rump
  ell([0, 0.795, 0.17], [0.162, 0.255, 0.3], "spine2", 0.09, "chest"),
  ell([0, 0.822, -0.14], [0.162, 0.178, 0.25], "spine1", 0.08, "belly"),
  ell([0, 0.872, -0.415], [0.14, 0.158, 0.18], "pelvis", 0.08, "rump"),
  cone([0, 0.935, -0.36], [0, 0.975, 0.24], 0.085, 0.09, "spine1", 0.07, "back"),
  ell([0, 0.935, 0.3], [0.1, 0.1, 0.17], "chest", 0.07, "back"),
  ell([0, 0.665, 0.4], [0.115, 0.13, 0.12], "chest", 0.07, "chest"),
  // neck (thick, swollen for the rut)
  cone([0, 0.92, 0.47], [0, 1.135, 0.63], 0.15, 0.112, "neck1", 0.08, "neck"),
  cone([0, 1.135, 0.63], [0, 1.31, 0.75], 0.112, 0.082, "neck2", 0.06, "neck"),
  ell([0, 0.98, 0.6], [0.1, 0.14, 0.1], "neck1", 0.07, "throat"),
  ell([0, 1.15, 0.69], [0.08, 0.1, 0.07], "neck2", 0.06, "throat"),
  // head
  ell([0, 1.378, 0.815], [0.074, 0.078, 0.098], "head", 0.04, "head"),
  ell([0, 1.345, 0.855], [0.066, 0.058, 0.066], "head", 0.03, "head"),
  cone([0, 1.352, 0.868], [0, 1.286, 1.04], 0.064, 0.036, "head", 0.03, "muzzle"),
  cone([0, 1.31, 0.82], [0, 1.256, 1.005], 0.056, 0.03, "head", 0.025, "jaw"),
  ell([0, 1.287, 1.058], [0.031, 0.028, 0.026], "head", 0.012, "nose"),
  // tail hangs down over the rump when relaxed
  cone([0, 0.95, -0.6], [0, 0.89, -0.665], 0.042, 0.04, "tail", 0.03, "tail"),
  cone([0, 0.89, -0.665], [0, 0.79, -0.7], 0.04, 0.03, "tail", 0.02, "tail"),
  ...legShapes(1),
  ...legShapes(-1),
];

/** Where each outside part sends a bullet that misses every organ. */
export const TAG_ZONE: Record<string, Zone> = {
  chest: "shoulder", belly: "paunch", rump: "ham", back: "back", neck: "neck", throat: "neck",
  head: "jaw", muzzle: "jaw", jaw: "jaw", nose: "jaw", tail: "ham", shoulder: "shoulder",
  ham: "ham", leg: "leg", hoof: "leg", antler: "antler",
};

export type Organ = { zone: Zone; prim: Prim };

/** Vital organs and bones, in the same bind pose (and owned by bones, so they move). */
export const ORGANS: Organ[] = [
  // whole cranium counts as a head shot (the muzzle/jaw below it does not)
  { zone: "brain", prim: ell([0, 1.385, 0.808], [0.055, 0.055, 0.07], "head", 0, "") },
  // heart: low in the chest, just behind the front leg
  { zone: "heart", prim: ell([0.01, 0.675, 0.33], [0.055, 0.075, 0.065], "spine2", 0, "") },
  // lungs fill the upper rib cage
  // (they reach forward under the shoulder blade, so a shoulder shot usually takes the lungs too)
  { zone: "lungs", prim: ell([0.06, 0.82, 0.22], [0.085, 0.165, 0.235], "spine2", 0, "") },
  { zone: "lungs", prim: ell([-0.06, 0.82, 0.22], [0.085, 0.165, 0.235], "spine2", 0, "") },
  { zone: "liver", prim: ell([-0.02, 0.77, -0.01], [0.13, 0.11, 0.075], "spine1", 0, "") },
  { zone: "paunch", prim: ell([0, 0.75, -0.18], [0.15, 0.17, 0.2], "spine1", 0, "") },
  // spine along the top of the back and up the neck
  { zone: "spine", prim: cone([0, 0.93, -0.5], [0, 0.95, 0.38], 0.032, 0.035, "spine1", 0, "") },
  { zone: "neck", prim: cone([0, 0.95, 0.42], [0, 1.14, 0.635], 0.037, 0.034, "neck1", 0, "") },
  { zone: "neck", prim: cone([0, 1.14, 0.635], [0, 1.33, 0.765], 0.034, 0.03, "neck2", 0, "") },
];

/** Bind-pose position of every joint, by name. */
export const JOINT_POS: Record<string, Vec> = Object.fromEntries(JOINTS.map((j) => [j.name, j.p]));
