import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, levelAt, sideOf, TURBO, TURBO_TIME, turboAt } from "./levels.ts";

test("classic levels get harder and stay inside the view", () => {
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].range[0] >= LEVELS[i - 1].range[0], `level ${i + 1} starts closer than level ${i}`);
    assert.ok(LEVELS[i].stand <= LEVELS[i - 1].stand);
  }
  for (const L of LEVELS) assert.ok(L.azim <= 30);
  assert.equal(levelAt(50), LEVELS[LEVELS.length - 1]); // the last one repeats
});

test("turbo: a minute a level, more bucks, sooner, never more than 4 at once", () => {
  assert.equal(TURBO_TIME, 60);
  assert.equal(turboAt(1).quota, 3);
  for (let n = 2; n <= 20; n++) {
    const a = turboAt(n - 1), b = turboAt(n);
    assert.ok(b.quota >= a.quota && b.every <= a.every && b.tier >= a.tier, `level ${n} is easier than ${n - 1}`);
    assert.ok(b.atOnce <= 4 && b.atOnce <= b.quota);
    assert.ok(b.tier >= 1 && b.tier <= LEVELS.length);
  }
  assert.equal(turboAt(TURBO.length), TURBO[TURBO.length - 1]);
  assert.equal(turboAt(100).tier, LEVELS.length); // far past the table: as far as the field goes
});

test("where a buck is, in words", () => {
  assert.equal(sideOf(-30), "Far left.");
  assert.equal(sideOf(-10), "On your left.");
  assert.equal(sideOf(0), "Straight out front.");
  assert.equal(sideOf(12), "On your right.");
  assert.equal(sideOf(28), "Far right.");
});
