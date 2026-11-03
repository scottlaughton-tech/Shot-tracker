// Scope picture overlay: black surround, eyepiece shading and a first-focal-plane reticle
// (marks are in milliradians, so they stay correct at every magnification).
//
// Reticle, from the centre out:
//  - fine crosshair with 1-mil ticks, heavy posts from 12 mil out
//  - bullet-drop marks below centre for 300..1000 m, computed from the real load. Each
//    mark is as wide as the lead for a WALKING buck at that range; the dots outside it
//    are the lead for a TROTTING buck.
//  - deer ranging scale bottom left: put the buck's belly on the bottom line; the number
//    the top of its back touches is the range in hundreds of metres (45 cm chest).
import { dropTable, leadMil, LOAD_308, type TableRow } from "../ballistics";

export const WALK_SPEED = 1.5;
export const TROT_SPEED = 3.5;
export const CHEST_DEPTH = 0.45;

let rows: TableRow[] | null = null;
export function bdcRows(): TableRow[] {
  return (rows ??= dropTable(LOAD_308, [300, 400, 500, 600, 700, 800, 900, 1000]));
}

export type ScopeDraw = {
  w: number; h: number; dpr: number;
  cx: number; cy: number; d: number;
  /** pixels per milliradian at the current magnification */
  pxPerMil: number;
  /** picture shake from recoil, px */
  jx: number; jy: number;
  zoom: number;
};

export function drawScope(ctx: CanvasRenderingContext2D, s: ScopeDraw) {
  const { w, h, dpr, cx, cy, d } = s;
  const r = d / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // eyepiece shading (inside the circle, darker toward the rim)
  const ex = cx + s.jx, ey = cy + s.jy;
  const g = ctx.createRadialGradient(ex, ey, r * 0.72, ex, ey, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.7, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0.95)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  // black surround
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2, true);
  ctx.fill("evenodd");

  // reticle (moves with the tube during recoil)
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.clip();
  ctx.translate(ex, ey);
  drawReticle(ctx, s.pxPerMil, r);
  ctx.restore();
}

function drawReticle(ctx: CanvasRenderingContext2D, m: number, r: number) {
  const ink = "rgba(8,8,8,0.92)";
  const fine = Math.max(1, Math.min(1.6, m * 0.035));
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "butt";

  // fine crosshair
  ctx.lineWidth = fine;
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
  ctx.moveTo(0, -r); ctx.lineTo(0, r);
  ctx.stroke();

  // heavy posts
  const post = 12 * m;
  ctx.lineWidth = Math.max(3, m * 0.35);
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.lineTo(-post, 0);
  ctx.moveTo(r, 0); ctx.lineTo(post, 0);
  ctx.moveTo(0, -r); ctx.lineTo(0, -post);
  ctx.stroke();

  // 1-mil ticks on the horizontal wire (longer every 5)
  ctx.lineWidth = fine;
  ctx.beginPath();
  for (let i = 1; i < 12; i++) {
    const t = i % 5 === 0 ? Math.max(4, m * 0.5) : Math.max(2.5, m * 0.25);
    for (const sgn of [-1, 1]) { ctx.moveTo(sgn * i * m, -t); ctx.lineTo(sgn * i * m, t); }
  }
  // ticks above centre
  for (let i = 1; i < 12; i++) {
    const t = Math.max(2.5, m * 0.25);
    ctx.moveTo(-t, -i * m); ctx.lineTo(t, -i * m);
  }
  ctx.stroke();

  // bullet-drop marks
  const fontPx = Math.max(9, Math.min(13, m * 0.55));
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (const row of bdcRows()) {
    const y = row.holdMil * m;
    if (y > r) break;
    const half = leadMil(row, WALK_SPEED) * m;
    const dot = leadMil(row, TROT_SPEED) * m;
    ctx.lineWidth = Math.max(1.2, fine * 1.2);
    ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
    const dr = Math.max(1.4, m * 0.07);
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(sgn * dot, y, dr, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillText(String(row.range / 100), half + 4, y);
  }

  // deer ranging scale (bottom left): base line, ticks at chest height for 2..6 hundred metres
  const bx = -8 * m, by = 9 * m;
  if (Math.hypot(bx, by) < r - 10) {
    ctx.lineWidth = fine;
    ctx.beginPath();
    ctx.moveTo(bx - 1.5 * m, by); ctx.lineTo(bx + 1.5 * m, by);
    ctx.moveTo(bx, by); ctx.lineTo(bx, by - (CHEST_DEPTH / 200) * 1000 * m);
    ctx.stroke();
    ctx.font = `600 ${Math.max(8, fontPx - 2)}px system-ui, sans-serif`;
    for (const hundreds of [2, 3, 4, 5, 6]) {
      const hy = by - (CHEST_DEPTH / (hundreds * 100)) * 1000 * m;
      const len = hundreds % 2 === 0 ? 1.1 * m : 0.7 * m;
      ctx.beginPath(); ctx.moveTo(bx, hy); ctx.lineTo(bx + (hundreds % 2 === 0 ? -len : len), hy); ctx.stroke();
      if (m > 9) {
        ctx.textAlign = hundreds % 2 === 0 ? "right" : "left";
        ctx.fillText(String(hundreds), bx + (hundreds % 2 === 0 ? -len - 3 : len + 3), hy);
      }
    }
    ctx.textAlign = "left";
  }
}
