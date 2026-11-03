import { test } from "node:test";
import assert from "node:assert/strict";
import { bearingTo, destination, distance, groupShots, triangulate, type Report } from "./geo.ts";

const shooter: [number, number] = [45.1, -78.3];

function reportFrom(name: string, bearingFromShooter: number, dist: number, t = 0, err = 0): Report {
  const [lat, lon] = destination(shooter[0], shooter[1], bearingFromShooter, dist);
  const b = bearingTo(lat, lon, shooter[0], shooter[1]) + err;
  return {
    id: name, name, lat, lon, accuracy: 5, bearingTrue: b, bearingInput: b,
    bearingRef: "true", declination: 0, shotTime: t, createdAt: t,
  };
}

test("two perfect bearings meet at the shooter", () => {
  const fix = triangulate([reportFrom("A", 200, 1500), reportFrom("B", 110, 900)]);
  assert.ok(fix);
  assert.ok(distance(fix.lat, fix.lon, shooter[0], shooter[1]) < 2);
});

test("three noisy bearings land close to the shooter with sensible uncertainty", () => {
  const fix = triangulate([
    reportFrom("A", 200, 1500, 0, 3),
    reportFrom("B", 110, 900, 0, -4),
    reportFrom("C", 330, 1200, 0, 2),
  ]);
  assert.ok(fix);
  const off = distance(fix.lat, fix.lon, shooter[0], shooter[1]);
  assert.ok(off < 150, `off by ${off}`);
  assert.ok(fix.major > 20 && fix.major < 1000, `major ${fix.major}`);
  assert.equal(fix.behind.length, 0);
});

test("parallel lines give no fix", () => {
  const a = reportFrom("A", 270, 1000);
  const b = { ...a, id: "B", name: "B", lat: a.lat + 0.01 };
  assert.equal(triangulate([a, b]), null);
});

test("two lines crossing behind a listener give no fix", () => {
  const a = reportFrom("A", 200, 1500);
  const b = reportFrom("B", 110, 900);
  b.bearingTrue = (b.bearingTrue + 180) % 360; // B points the wrong way
  assert.equal(triangulate([a, b]), null);
});

test("grouping uses the window from the first report of each shot", () => {
  const m = 60_000;
  const rs = [0, 1, 2.5, 10, 11].map((t, i) => reportFrom(`R${i}`, 90 * i, 1000, t * m));
  const shots = groupShots(rs, 3);
  assert.deepEqual(shots.map((s) => s.reports.length), [3, 2]);
});
