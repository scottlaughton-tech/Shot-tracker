// Side view of the buck with his vitals and where each bullet went in (results screen).
import { BODY, ORGANS } from "../deer/anatomy";
import type { Prim } from "../deer/sdf";
import type { Zone } from "../scoring";

const ORGAN_COL: Partial<Record<Zone, string>> = {
  heart: "#e03131", lungs: "#f783ac", liver: "#a0522d", paunch: "#8f9e5a", brain: "#ffd8a8", spine: "#dee2e6", neck: "#dee2e6",
};

function shape(p: Prim, fill: string, key: string, opacity = 1) {
  if (p.kind === "ell") return <ellipse key={key} cx={p.c[2]} cy={-p.c[1]} rx={p.r[2]} ry={p.r[1]} fill={fill} opacity={opacity} />;
  // tapered capsule: two circles joined by a quad
  const [az, ay] = [p.a[2], -p.a[1]], [bz, by] = [p.b[2], -p.b[1]];
  const dz = bz - az, dy = by - ay, L = Math.hypot(dz, dy) || 1, nz = -dy / L, ny = dz / L;
  const pts = [[az + nz * p.r1, ay + ny * p.r1], [bz + nz * p.r2, by + ny * p.r2], [bz - nz * p.r2, by - ny * p.r2], [az - nz * p.r1, ay - ny * p.r1]];
  return (
    <g key={key} opacity={opacity}>
      <circle cx={az} cy={ay} r={p.r1} fill={fill} />
      <circle cx={bz} cy={by} r={p.r2} fill={fill} />
      <polygon points={pts.map((q) => q.join(",")).join(" ")} fill={fill} />
    </g>
  );
}

export default function DeerDiagram({ marks }: { marks: { y: number; z: number; zone: Zone }[] }) {
  // only the near-side legs (x > 0) so the outline stays clean
  const body = BODY.filter((p) => (p.kind === "ell" ? p.c[0] : p.a[0]) >= -0.01);
  return (
    <svg className="g-diagram" viewBox="-0.8 -1.55 1.95 1.6" role="img" aria-label="Where the bullets hit">
      {body.map((p, i) => shape(p, "#7a6650", `b${i}`))}
      {ORGANS.filter((o) => o.zone !== "spine" && o.zone !== "neck" && (o.prim.kind !== "ell" || o.prim.c[0] >= 0)).map((o, i) => shape(o.prim, ORGAN_COL[o.zone] ?? "#fff", `o${i}`, 0.75))}
      {marks.map((m, i) => (
        <g key={`m${i}`} transform={`translate(${m.z} ${-m.y})`}>
          <circle r={0.035} fill="none" stroke="#fff" strokeWidth={0.012} />
          <circle r={0.012} fill="#fff" />
        </g>
      ))}
    </svg>
  );
}
