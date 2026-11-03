import { test } from "node:test";
import assert from "node:assert/strict";
import { type BulletState, dropTable, g1Raw, leadMil, LOAD_308, stepBullet, zeroAngle } from "./ballistics.ts";

test("G1 table has no jumps between its pieces", () => {
  const breaks = [4230, 3680, 3450, 3295, 3130, 2960, 2830, 2680, 2460, 2225, 2015, 1890, 1810, 1730,
    1595, 1520, 1420, 1360, 1315, 1280, 1220, 1185, 1150, 1100, 1060, 1025, 980, 945, 905, 860, 810,
    780, 750, 700, 640, 600, 550, 250, 100, 65];
  for (const b of breaks) {
    const r = g1Raw(b + 1e-3) / g1Raw(b - 1e-3);
    assert.ok(Math.abs(r - 1) < 0.03, `jump at ${b} fps: ${r}`);
  }
});

test(".308 150 gr matches published drop (200 yd zero)", () => {
  const yd = { ...LOAD_308, zero: 182.88 };
  const [r300, r400, r500] = dropTable(yd, [274.32, 365.76, 457.2]);
  const inches = (m: number) => m / 0.0254;
  // Factory tables for this class of load: about -8.5", -25", -51"
  assert.ok(Math.abs(inches(r300.drop) + 8.5) < 1.0, `300 yd ${inches(r300.drop)}`);
  assert.ok(Math.abs(inches(r400.drop) + 25) < 2.0, `400 yd ${inches(r400.drop)}`);
  assert.ok(Math.abs(inches(r500.drop) + 51) < 4.0, `500 yd ${inches(r500.drop)}`);
});

test("crosses the crosshair at the zero distance, rises above it before", () => {
  const [r100, r200] = dropTable(LOAD_308, [100, 200]);
  assert.ok(Math.abs(r200.drop) < 0.002);
  assert.ok(r100.drop > 0.03 && r100.drop < 0.09);
});

test("holdover and lead grow with range", () => {
  const rows = dropTable(LOAD_308, [300, 500, 800]);
  assert.ok(rows[0].holdMil < rows[1].holdMil && rows[1].holdMil < rows[2].holdMil);
  assert.ok(rows[2].velocity > 300, "still supersonic at 800 m");
  // walking deer (1.5 m/s) at 300 m needs about 2 mil of lead
  const lead = leadMil(rows[0], 1.5);
  assert.ok(lead > 1.8 && lead < 2.4, `lead ${lead}`);
});

test("3D stepper agrees with the flat table", () => {
  const a = zeroAngle(LOAD_308);
  const s: BulletState = { p: [0, -LOAD_308.sightHeight, 0], v: [0, LOAD_308.mv * Math.sin(a), -LOAD_308.mv * Math.cos(a)], t: 0 };
  while (-s.p[2] < 400) stepBullet(s, 0.001, LOAD_308.bc);
  const [row] = dropTable(LOAD_308, [400]);
  assert.ok(Math.abs(s.p[1] - row.drop) < 0.03, `${s.p[1]} vs ${row.drop}`);
});
