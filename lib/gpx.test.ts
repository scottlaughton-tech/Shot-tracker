import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGpx, simplify, trailLength, DEFAULT_TRAIL_COLOR } from "./gpx.ts";

const TOPO_MAPS = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Topo Maps">
<trk>
<name>Ridge Loop</name>
<desc>KML Import</desc>
<cmt>yellow</cmt>
<trkseg>
<trkpt lat="46.500100" lon="-80.200100"><ele>0.0</ele></trkpt>
<trkpt lat="46.500300" lon="-80.199800"><ele>0.0</ele></trkpt>
<trkpt lat="46.501200" lon="-80.198900"><ele>0.0</ele></trkpt>
</trkseg>
</trk>
</gpx>`;

test("reads a Topo Maps track with its name and colour", () => {
  const [t, ...rest] = parseGpx(TOPO_MAPS, "file");
  assert.equal(rest.length, 0);
  assert.equal(t.name, "Ridge Loop");
  assert.equal(t.color, "#ffd43b");
  assert.equal(t.lines.length, 1);
  assert.deepEqual(t.lines[0][0], [46.5001, -80.2001]);
  assert.equal(t.lines[0].length, 3);
});

test("routes, several segments, unnamed tracks and attribute order", () => {
  const xml = `<gpx><trk><trkseg><trkpt lon="-78.1" lat="45.1"/><trkpt lon="-78.2" lat="45.2"/></trkseg>
    <trkseg><trkpt lat='45.3' lon='-78.3'></trkpt><trkpt lat='45.4' lon='-78.4'></trkpt></trkseg></trk>
    <rte><name>Road &amp; gate</name><rtept lat="45.0" lon="-78.0"/><rtept lat="45.01" lon="-78.01"/></rte></gpx>`;
  const t = parseGpx(xml, "my-file");
  assert.equal(t.length, 2);
  assert.equal(t[0].name, "my-file");
  assert.equal(t[0].lines.length, 2);
  assert.deepEqual(t[0].lines[0][0], [45.1, -78.1]);
  assert.equal(t[0].color, DEFAULT_TRAIL_COLOR);
  assert.equal(t[1].name, "Road & gate");
});

test("simplify keeps the ends and the corners, drops points on a straight line", () => {
  const line: [number, number][] = [];
  for (let i = 0; i <= 10; i++) line.push([45 + i * 0.0001, -78]);          // straight north ~111 m
  for (let i = 1; i <= 10; i++) line.push([45.001, -78 + i * 0.0001]);      // then east
  const s = simplify(line, 2);
  assert.equal(s.length, 3);
  assert.ok(Math.abs(trailLength([line]) - trailLength([s])) < 0.5);
});
