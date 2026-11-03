import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY, ORGANS, TAG_ZONE } from "./deer/anatomy.ts";
import { primDist, type Vec } from "./deer/sdf.ts";
import { primaryZone, type Zone } from "./scoring.ts";

/** Fire a straight line through the standing buck (bind pose): which zones does it cross? */
function shoot(from: Vec, dir: Vec): Zone[] {
  const zones = new Set<Zone>();
  let entered = false;
  for (let s = 0; s < 3; s += 0.005) {
    const p: Vec = [from[0] + dir[0] * s, from[1] + dir[1] * s, from[2] + dir[2] * s];
    if (!entered) {
      const hit = BODY.find((b) => primDist(b, ...p) < 0);
      if (hit) { entered = true; zones.add(TAG_ZONE[hit.tag]); }
      continue;
    }
    for (const o of ORGANS) if (primDist(o.prim, ...p) < 0) zones.add(o.zone);
  }
  return [...zones];
}
// broadside, from the deer's left side
const side = (y: number, z: number) => primaryZone(shoot([1, y, z], [-1, 0, 0]));

test("broadside behind the shoulder: heart low, lungs in the middle", () => {
  assert.equal(side(0.675, 0.33), "heart");
  assert.equal(side(0.84, 0.2), "lungs");
});

test("head and neck", () => {
  assert.equal(side(1.385, 0.81), "brain");
  assert.equal(side(1.25, 1.0), "jaw");
  assert.equal(side(1.05, 0.58), "neck");
});

test("too far back: liver, then gut, then the hindquarter", () => {
  assert.equal(side(0.77, -0.01), "liver");
  assert.equal(side(0.72, -0.25), "paunch");
  assert.equal(side(0.8, -0.48), "ham");
});

test("a shot through the middle of the shoulder takes the lungs", () => {
  assert.equal(side(0.84, 0.4), "lungs");
});

test("legs only wound", () => {
  assert.equal(side(0.25, 0.345), "leg");
  assert.equal(side(0.3, -0.46), "leg");
});

test("a shot over the back misses", () => {
  assert.deepEqual(shoot([1, 1.15, 0.0], [-1, 0, 0]), []);
});

test("every organ is inside the body", () => {
  for (const o of ORGANS) {
    const p = o.prim;
    const c: Vec = p.kind === "ell" ? p.c : [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    assert.ok(BODY.some((b) => primDist(b, ...c) < 0), `${o.zone} centre is outside the body`);
  }
});
