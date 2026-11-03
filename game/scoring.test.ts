import { test } from "node:test";
import assert from "node:assert/strict";
import { isLethal, killScore, primaryZone, SCORE } from "./scoring.ts";

test("the most lethal zone on the bullet's path decides", () => {
  assert.equal(primaryZone(["shoulder", "lungs", "heart"]), "heart");
  assert.equal(primaryZone(["paunch", "liver"]), "liver");
  assert.equal(primaryZone(["antler"]), "antler");
  assert.equal(primaryZone([]), null);
});

test("vitals and head kill, rump/gut/leg only wound", () => {
  for (const z of ["brain", "heart", "lungs", "spine", "neck", "liver"] as const) assert.ok(isLethal(z), z);
  for (const z of ["paunch", "ham", "leg", "jaw", "shoulder", "antler"] as const) assert.ok(!isLethal(z), z);
});

test("better shots score more", () => {
  const base = { range: 200, gait: "stand" as const, antlerPoints: 8, oneShot: true };
  const heart = killScore({ ...base, zone: "heart" }).total;
  const liver = killScore({ ...base, zone: "liver" }).total;
  assert.ok(heart > liver);
  const far = killScore({ ...base, zone: "heart", range: 400 }).total;
  assert.equal(far - heart, SCORE.rangeBonus(400) - SCORE.rangeBonus(200));
  const running = killScore({ ...base, zone: "heart", gait: "run" }).total;
  assert.equal(running - heart, SCORE.motion.run);
  const follow = killScore({ ...base, zone: "heart", oneShot: false }).total;
  assert.equal(heart - follow, SCORE.oneShotBonus);
});
