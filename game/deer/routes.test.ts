import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroundCache } from "../world/layout.ts";
import { mulberry32 } from "../world/noise.ts";
import { LEVELS } from "../levels.ts";
import { makeRoute, seenFromStand, VIEW } from "./routes.ts";

buildGroundCache();

test("every level can send bucks, and all they do in the open is in sight of the stand", () => {
  const rnd = mulberry32(3);
  for (const L of LEVELS) {
    for (let k = 0; k < 8; k++) {
      let r = null;
      for (let i = 0; i < 30 && !r; i++) r = makeRoute(rnd, L.range, (L.azim * Math.PI) / 180);
      assert.ok(r, `no route for ${L.range.join("–")} m`);
      // from stepping out to the last leg (the start and the exit are inside the cover)
      for (const p of r.points.slice(2, r.points.length - 2)) {
        assert.ok(seenFromStand(p.x, p.z), `hidden point (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) for ${L.range.join("–")} m`);
        assert.ok(Math.abs(Math.atan2(p.x, -p.z)) <= VIEW + 0.01, "outside the view");
      }
      const spot = r.points[r.poseAt], range = Math.hypot(spot.x, spot.z);
      assert.ok(range >= L.range[0] - 1 && range <= L.range[1] + 1, `stands at ${range.toFixed(0)} m for ${L.range.join("–")} m`);
    }
  }
});

test("a buck straight behind an island can't be seen; one out in the field can", () => {
  assert.equal(seenFromStand(72 * 1.6, -142 * 1.6), false); // behind the island 160 m out, right
  assert.equal(seenFromStand(-68 * 1.6, -118 * 1.6), false); // behind the clump 136 m out, left
  assert.equal(seenFromStand(0, -200), true);
});
