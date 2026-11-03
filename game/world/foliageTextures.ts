// Hand-drawn (by code) foliage and bark textures for November in the Ontario bush.
// One 2048² atlas of 4×4 cells holds every leaf/needle/twig card; bark gets its own tiles.
import * as THREE from "three";
import { mulberry32 } from "./noise";

export const ATLAS_CELLS = 4;
export enum Card {
  Spruce = 0, Fir, WhitePine, Cedar,
  Tamarack, TwigMaple, TwigFine, Oak,
  Beech, Dogwood, Alder, Grass,
  Goldenrod, Sapling, Sumac, Fern,
}

/** UV rectangle [u0, v0, u1, v1] of an atlas cell (v up, three.js convention). */
export function cellUV(c: Card): [number, number, number, number] {
  const col = c % ATLAS_CELLS, row = Math.floor(c / ATLAS_CELLS);
  const s = 1 / ATLAS_CELLS, pad = 0.002;
  return [col * s + pad, 1 - (row + 1) * s + pad, (col + 1) * s - pad, 1 - row * s - pad];
}

type Rnd = () => number;
const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function jitter(rnd: Rnd, base: [number, number, number], amt: number, a = 1) {
  const k = 1 + (rnd() - 0.5) * amt;
  return rgb(base[0] * k * (1 + (rnd() - 0.5) * 0.1), base[1] * k, base[2] * k * (1 + (rnd() - 0.5) * 0.1), a);
}

// --- needle sprays -----------------------------------------------------------------------

function drawNeedleTwig(g: CanvasRenderingContext2D, rnd: Rnd, x0: number, y0: number, ang: number, len: number,
  needle: number, dark: [number, number, number], light: [number, number, number], width: number, density = 1) {
  const steps = Math.ceil(len / 2.2 / density);
  // stem
  g.strokeStyle = rgb(70, 52, 36);
  g.lineWidth = width;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); g.stroke();
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const px = x0 + Math.cos(ang) * len * t, py = y0 + Math.sin(ang) * len * t;
    const nl = needle * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.3 + 0.1))) * (0.8 + rnd() * 0.4);
    for (const side of [-1, 1]) {
      const a = ang + side * (0.9 + rnd() * 0.5) - 0.35 * side * t;
      g.strokeStyle = t > 0.82 ? jitter(rnd, light, 0.25) : jitter(rnd, dark, 0.35);
      g.lineWidth = 1.3 + rnd() * 0.6;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
    }
  }
}

function drawSpray(g: CanvasRenderingContext2D, rnd: Rnd, S: number, dark: [number, number, number], light: [number, number, number], needle: number, density = 1) {
  // A conifer branch seen from above/side: an irregular mass of twigs, each thick with short
  // needles, darker toward the middle, with bright new growth at the tips.
  const y = S * 0.5;
  const len = S * 0.94;
  const tw = (x0: number, y0: number, a: number, l: number, depth: number, w: number) => {
    const steps = 5;
    let x = x0, yy = y0, ang = a;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < steps; i++) {
      ang += (rnd() - 0.5) * 0.25;
      const nx = x + Math.cos(ang) * l / steps, ny = yy + Math.sin(ang) * l / steps + l * 0.012 * i; // slight droop
      pts.push([x, yy, ang]);
      x = nx; yy = ny;
    }
    pts.push([x, yy, ang]);
    // needles all along this twig
    for (let i = 0; i < pts.length - 1; i++) {
      const [px, py, pa] = pts[i];
      const [qx, qy] = pts[i + 1];
      const n = Math.ceil((Math.hypot(qx - px, qy - py) / 2.0) / density);
      for (let k = 0; k < n; k++) {
        const t = k / n, bx = px + (qx - px) * t, by = py + (qy - py) * t;
        const along = (i + t) / (pts.length - 1);
        const nl = needle * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, along * 1.2 + 0.1))) * (0.7 + rnd() * 0.5) * (depth ? 0.8 : 1);
        for (const side of [-1, 1]) {
          const na = pa + side * (0.7 + rnd() * 0.8);
          const tip = along > 0.8;
          g.strokeStyle = tip ? jitter(rnd, light, 0.3) : jitter(rnd, dark, 0.4);
          g.lineWidth = 1.2 + rnd() * 0.9;
          g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(na) * nl, by + Math.sin(na) * nl); g.stroke();
        }
      }
    }
    // side twigs
    if (depth < 2) {
      const kids = depth === 0 ? 11 : 4;
      for (let k = 0; k < kids; k++) {
        const t = 0.1 + 0.85 * (k / kids) + (rnd() - 0.5) * 0.06;
        const i = Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)));
        const [px, py, pa] = pts[i];
        const shape = Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.6 + rnd() * 0.55);
        const sl = l * (depth === 0 ? 0.52 : 0.4) * shape;
        if (sl < needle) continue;
        const side = k % 2 ? 1 : -1;
        tw(px, py, pa + side * (0.75 + rnd() * 0.5), sl, depth + 1, w * 0.6);
      }
    }
    g.strokeStyle = rgb(62, 46, 34, 0.8);
    g.lineWidth = w;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts) g.lineTo(q[0], q[1]); g.stroke();
  };
  tw(S * 0.02, y, (rnd() - 0.5) * 0.1, len, 0, 3);
}

function drawPineTuft(g: CanvasRenderingContext2D, rnd: Rnd, S: number) {
  // white pine: soft, long blue-green needles in clumpy bundles along an upturned twig
  g.strokeStyle = rgb(80, 60, 45); g.lineWidth = 3;
  g.beginPath(); g.moveTo(S * 0.02, S * 0.56); g.quadraticCurveTo(S * 0.5, S * 0.56, S * 0.94, S * 0.44); g.stroke();
  const tufts = 26;
  for (let k = 0; k < tufts; k++) {
    const t = rnd();
    const cx = S * (0.08 + 0.86 * t), cy = S * (0.56 - 0.1 * t) + (rnd() - 0.5) * S * 0.1;
    const r = S * (0.08 + 0.1 * Math.sin(Math.PI * t)) * (0.7 + rnd() * 0.5);
    const shade = rnd();
    for (let i = 0; i < 45; i++) {
      const a = -Math.PI * 0.5 + (rnd() - 0.5) * Math.PI * 1.6;
      const l = r * (0.55 + rnd() * 0.5);
      const base: [number, number, number] = shade < 0.35 ? [52, 74, 62] : shade < 0.8 ? [72, 98, 84] : [104, 130, 112];
      g.strokeStyle = jitter(rnd, base, 0.25, 0.9);
      g.lineWidth = 0.9 + rnd() * 0.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + Math.cos(a) * l * 0.5, cy + Math.sin(a) * l * 0.5 + l * 0.15, cx + Math.cos(a) * l, cy + Math.sin(a) * l + l * 0.3);
      g.stroke();
    }
  }
}

function drawCedar(g: CanvasRenderingContext2D, rnd: Rnd, S: number) {
  // flat fans of scaly foliage
  const fan = (x: number, y: number, a: number, l: number, depth: number) => {
    const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
    g.strokeStyle = jitter(rnd, depth > 1 ? [62, 84, 50] : [88, 112, 62], 0.3);
    g.lineWidth = 2 + depth * 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    if (depth <= 0 || l < 8) return;
    const k = 5;
    for (let i = 1; i <= k; i++) {
      const t = i / (k + 1);
      for (const s of [-1, 1]) fan(x + (ex - x) * t, y + (ey - y) * t, a + s * (0.6 + rnd() * 0.3), l * 0.42 * (1 - t * 0.5), depth - 1);
    }
  };
  fan(S * 0.03, S * 0.5, 0, S * 0.9, 3);
}

// --- bare twigs and leaf clusters -------------------------------------------------------

function drawTwigs(g: CanvasRenderingContext2D, rnd: Rnd, S: number, col: [number, number, number], baseW: number, depthMax: number, spread: number,
  leaf?: (x: number, y: number, a: number) => void) {
  const branch = (x: number, y: number, a: number, l: number, w: number, depth: number) => {
    let cx = x, cy = y, ca = a;
    const segs = 4;
    g.strokeStyle = jitter(rnd, col, 0.25);
    g.lineCap = "round";
    for (let s = 0; s < segs; s++) {
      ca += (rnd() - 0.5) * 0.35;
      const nx = cx + Math.cos(ca) * (l / segs), ny = cy + Math.sin(ca) * (l / segs);
      g.lineWidth = Math.max(0.6, w * (1 - (s / segs) * 0.45));
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
      cx = nx; cy = ny;
    }
    if (depth >= depthMax) {
      if (leaf) leaf(cx, cy, ca);
      return;
    }
    const kids = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const da = (k - (kids - 1) / 2) * spread + (rnd() - 0.5) * 0.4;
      branch(cx, cy, ca + da, l * (0.62 + rnd() * 0.2), w * 0.62, depth + 1);
    }
    // a few side twigs along the way
    if (depth < depthMax - 1 && rnd() < 0.7) branch(x + (cx - x) * 0.5, y + (cy - y) * 0.5, ca + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.4), l * 0.45, w * 0.5, depth + 2);
  };
  branch(S * 0.5, S * 0.99, -Math.PI / 2, S * (leaf ? 0.22 : 0.27), baseW, 0);
}

function lobedLeaf(g: CanvasRenderingContext2D, rnd: Rnd, x: number, y: number, a: number, len: number, fill: string, lobes: number) {
  g.save();
  g.translate(x, y);
  g.rotate(a + (rnd() - 0.5) * 1.2);
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(0, 0);
  const w = len * 0.38;
  for (let i = 0; i <= lobes; i++) {
    const t = i / lobes;
    const r = w * Math.sin(Math.PI * t) * (i % 2 ? 1 : 0.62);
    g.lineTo(len * t, -r);
  }
  for (let i = lobes; i >= 0; i--) {
    const t = i / lobes;
    const r = w * Math.sin(Math.PI * t) * (i % 2 ? 1 : 0.62);
    g.lineTo(len * t, r);
  }
  g.closePath();
  g.fill();
  // midrib, slightly darker
  g.strokeStyle = "rgba(40,25,15,0.5)";
  g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.9, 0); g.stroke();
  g.restore();
}

// --- ground plants ------------------------------------------------------------------------

function drawGrassClump(g: CanvasRenderingContext2D, rnd: Rnd, S: number) {
  for (let i = 0; i < 160; i++) {
    const x0 = S * (0.5 + (rnd() - 0.5) * 0.55);
    const h = S * (0.45 + rnd() * 0.5);
    const lean = (rnd() - 0.5) * S * 0.45;
    const dead = rnd();
    g.strokeStyle = dead < 0.12 ? jitter(rnd, [120, 128, 70], 0.3) : dead < 0.55 ? jitter(rnd, [176, 150, 98], 0.3) : jitter(rnd, [140, 112, 72], 0.35);
    g.lineWidth = 1.2 + rnd() * 1.8;
    g.beginPath();
    g.moveTo(x0, S);
    g.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h);
    g.stroke();
    if (rnd() < 0.15) {
      // seed head
      g.fillStyle = jitter(rnd, [150, 125, 90], 0.3);
      g.beginPath(); g.ellipse(x0 + lean, S - h, 2.5, 9, Math.atan2(lean, h) * 0.6, 0, Math.PI * 2); g.fill();
    }
  }
}

function drawGoldenrod(g: CanvasRenderingContext2D, rnd: Rnd, S: number) {
  for (let i = 0; i < 9; i++) {
    const x0 = S * (0.2 + rnd() * 0.6), h = S * (0.6 + rnd() * 0.35), lean = (rnd() - 0.5) * S * 0.15;
    g.strokeStyle = jitter(rnd, [104, 80, 58], 0.3); g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(x0, S); g.quadraticCurveTo(x0, S - h * 0.5, x0 + lean, S - h); g.stroke();
    // dead leaves on the stem
    for (let k = 0; k < 8; k++) {
      const t = 0.15 + k * 0.08, yy = S - h * t;
      g.strokeStyle = jitter(rnd, [92, 74, 52], 0.3); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0 + lean * t * t, yy); g.lineTo(x0 + lean * t * t + (k % 2 ? 1 : -1) * S * 0.05, yy + S * 0.03); g.stroke();
    }
    // fluffy grey-brown seed plume
    for (let k = 0; k < 40; k++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, r = rnd() * S * 0.08;
      g.fillStyle = jitter(rnd, [132, 114, 88], 0.25, 0.85);
      g.beginPath(); g.arc(x0 + lean + Math.cos(a) * r, S - h + Math.sin(a) * r * 0.9 + S * 0.03, 2 + rnd() * 2.5, 0, Math.PI * 2); g.fill();
    }
  }
}

function drawStems(g: CanvasRenderingContext2D, rnd: Rnd, S: number, col: [number, number, number], count: number, budCol?: [number, number, number]) {
  for (let i = 0; i < count; i++) {
    const x0 = S * (0.5 + (rnd() - 0.5) * 0.4);
    let x = x0, y = S, a = -Math.PI / 2 + (rnd() - 0.5) * 0.7, w = 4 + rnd() * 3;
    const len = S * (0.5 + rnd() * 0.45);
    const segs = 10;
    for (let s = 0; s < segs; s++) {
      const nx = x + Math.cos(a) * len / segs, ny = y + Math.sin(a) * len / segs;
      g.strokeStyle = jitter(rnd, col, 0.2); g.lineWidth = w; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (s > 3 && rnd() < 0.45) {
        const sa = a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.4), sl = S * 0.12 * (0.5 + rnd());
        g.lineWidth = w * 0.55;
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(sa) * sl, ny + Math.sin(sa) * sl); g.stroke();
        if (budCol) { g.fillStyle = jitter(rnd, budCol, 0.2); g.beginPath(); g.ellipse(nx + Math.cos(sa) * sl, ny + Math.sin(sa) * sl, 2.5, 6, sa, 0, Math.PI * 2); g.fill(); }
      }
      x = nx; y = ny; a += (rnd() - 0.5) * 0.25; w *= 0.9;
    }
  }
}

function drawFern(g: CanvasRenderingContext2D, rnd: Rnd, S: number) {
  // dead bracken: rusty-brown fronds
  for (let f = 0; f < 4; f++) {
    const x0 = S * (0.3 + rnd() * 0.4), a0 = -Math.PI / 2 + (rnd() - 0.5) * 1.2, len = S * (0.55 + rnd() * 0.3);
    const col: [number, number, number] = [150 + rnd() * 30, 90 + rnd() * 20, 50];
    let x = x0, y = S;
    for (let i = 0; i < 24; i++) {
      const t = i / 24, a = a0 + t * 0.9;
      const nx = x + Math.cos(a) * len / 24, ny = y + Math.sin(a) * len / 24;
      g.strokeStyle = jitter(rnd, col, 0.2); g.lineWidth = 2.5 * (1 - t) + 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (t > 0.2) for (const s of [-1, 1]) {
        const pl = S * 0.13 * Math.sin(Math.PI * t), pa = a + s * 1.3;
        g.lineWidth = 3.5 * (1 - t) + 1;
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(pa) * pl, ny + Math.sin(pa) * pl + pl * 0.3); g.stroke();
      }
      x = nx; y = ny;
    }
  }
}

/** Draws the foliage atlas from scratch (slow: ~3 s on a laptop). */
export function drawFoliageAtlas(): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S * ATLAS_CELLS;
  const g = c.getContext("2d")!;
  const cells: Record<Card, (g: CanvasRenderingContext2D, rnd: Rnd) => void> = {
    [Card.Spruce]: (g, r) => drawSpray(g, r, S, [38, 58, 44], [72, 96, 70], 16),
    [Card.Fir]: (g, r) => drawSpray(g, r, S, [40, 66, 40], [80, 110, 64], 19, 0.9),
    [Card.WhitePine]: (g, r) => drawPineTuft(g, r, S),
    [Card.Cedar]: (g, r) => drawCedar(g, r, S),
    [Card.Tamarack]: (g, r) => drawSpray(g, r, S, [150, 120, 62], [178, 146, 80], 12, 0.75),
    [Card.TwigMaple]: (g, r) => { drawTwigs(g, r, S, [132, 122, 112], 9, 6, 0.5); drawTwigs(g, r, S, [120, 110, 102], 6, 5, 0.65); },
    [Card.TwigFine]: (g, r) => { drawTwigs(g, r, S, [100, 70, 62], 6, 6, 0.45); drawTwigs(g, r, S, [92, 66, 58], 5, 5, 0.6); },
    [Card.Oak]: (g, r) => drawTwigs(g, r, S, [76, 64, 54], 6, 3, 0.65, (x, y, a) => {
      for (let i = 0; i < 6; i++) {
        const shade = r();
        const col = shade < 0.4 ? [112, 80, 56] : shade < 0.8 ? [128, 95, 64] : [90, 64, 44];
        lobedLeaf(g, r, x, y, a + (i - 2.5) * 0.5, 34 + r() * 22, jitter(r, col as [number, number, number], 0.2), 7);
      }
    }),
    [Card.Beech]: (g, r) => drawTwigs(g, r, S, [110, 100, 90], 5, 4, 0.5, (x, y, a) => {
      for (let i = 0; i < 4; i++) lobedLeaf(g, r, x, y, a + (i - 1.5) * 0.7, 30 + r() * 16, jitter(r, [178, 148, 106], 0.18), 10);
    }),
    [Card.Dogwood]: (g, r) => drawStems(g, r, S, [128, 44, 40], 14),
    [Card.Alder]: (g, r) => drawStems(g, r, S, [84, 76, 70], 12, [96, 70, 50]),
    [Card.Grass]: (g, r) => drawGrassClump(g, r, S),
    [Card.Goldenrod]: (g, r) => drawGoldenrod(g, r, S),
    [Card.Sapling]: (g, r) => drawSpray(g, r, S, [44, 70, 46], [86, 118, 72], 14, 1.1),
    [Card.Sumac]: (g, r) => drawStems(g, r, S, [120, 92, 74], 6, [140, 40, 34]),
    [Card.Fern]: (g, r) => drawFern(g, r, S),
  };
  for (let i = 0; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
    const col = i % ATLAS_CELLS, row = Math.floor(i / ATLAS_CELLS);
    g.save();
    g.translate(col * S, row * S);
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    cells[i as Card]?.(g, mulberry32(1000 + i));
    g.restore();
  }
  return c;
}

/**
 * The foliage atlas. Loads the pre-drawn copy (public/game/tex/atlas.webp, made by
 * `npm run bake-atlas`) and only draws it in code if that's missing.
 */
export async function foliageAtlas(): Promise<THREE.Texture> {
  const S = 512 * ATLAS_CELLS;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const res = await fetch("/game/tex/atlas.webp");
    if (res.ok) {
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = S;
      canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0, S, S);
    }
  } catch { canvas = null; }
  return coverageMipmapTexture(canvas ?? drawFoliageAtlas(), 0.42);
}

/**
 * Alpha-tested cards (needles, twigs) vanish in the distance with normal mipmaps because thin
 * lines average down to low alpha. Mip levels are built here by hand: colours are averaged
 * weighted by alpha (no dark or grey fringes), transparent pixels get their neighbours' colour,
 * and each level's alpha is boosted so the same share of each cell passes the alpha test.
 */
export function coverageMipmapTexture(src: HTMLCanvasElement, cutoff: number): THREE.Texture {
  const cells = ATLAS_CELLS;
  const W0 = src.width;
  const tg = performance.now();
  const img = src.getContext("2d")!.getImageData(0, 0, W0, W0).data;
  if (location.search.includes("debug")) console.log(`[t]   atlas raster/readback ${(performance.now() - tg).toFixed(0)} ms`);
  type Level = { w: number; r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array };
  // level 0, rows flipped so v=0 is the bottom (three.js convention)
  const L0: Level = { w: W0, r: new Float32Array(W0 * W0), g: new Float32Array(W0 * W0), b: new Float32Array(W0 * W0), a: new Float32Array(W0 * W0) };
  for (let y = 0; y < W0; y++) {
    let si = (W0 - 1 - y) * W0 * 4, di = y * W0;
    for (let x = 0; x < W0; x++, si += 4, di++) { L0.r[di] = img[si]; L0.g[di] = img[si + 1]; L0.b[di] = img[si + 2]; L0.a[di] = img[si + 3]; }
  }
  const thr = cutoff * 255;
  const cover = (lv: Level, cx: number, cy: number, cs: number, scale: number) => {
    let n = 0;
    const t = thr / scale;
    for (let y = cy; y < cy + cs; y++) { const row = y * lv.w; for (let x = cx; x < cx + cs; x++) if (lv.a[row + x] >= t) n++; }
    return n / (cs * cs);
  };
  const target: number[] = [];
  const cs0 = W0 / cells;
  // bare twigs should thin to a see-through haze in the distance, needles stay solid
  const keep: Record<number, number> = { [Card.TwigMaple]: 0.5, [Card.TwigFine]: 0.5, [Card.Dogwood]: 0.7, [Card.Alder]: 0.7, [Card.Sumac]: 0.7, [Card.Goldenrod]: 0.8 };
  // (cells are counted from the bottom here because the rows were flipped)
  const cardOf = (i: number) => (cells - 1 - Math.floor(i / cells)) * cells + (i % cells);
  for (let i = 0; i < cells * cells; i++) target.push(cover(L0, (i % cells) * cs0, Math.floor(i / cells) * cs0, cs0, 1) * (keep[cardOf(i)] ?? 1));
  // build the chain: alpha-weighted colour averages, then restore each cell's alpha-test coverage
  const levels: Level[] = [L0];
  while (levels[levels.length - 1].w > 1) {
    const p = levels[levels.length - 1], w = p.w >> 1;
    const q: Level = { w, r: new Float32Array(w * w), g: new Float32Array(w * w), b: new Float32Array(w * w), a: new Float32Array(w * w) };
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i0 = (y * 2) * p.w + x * 2, i1 = i0 + 1, i2 = i0 + p.w, i3 = i2 + 1;
      const a0 = p.a[i0] + 0.01, a1 = p.a[i1] + 0.01, a2 = p.a[i2] + 0.01, a3 = p.a[i3] + 0.01;
      const sa = a0 + a1 + a2 + a3, k = y * w + x;
      q.r[k] = (p.r[i0] * a0 + p.r[i1] * a1 + p.r[i2] * a2 + p.r[i3] * a3) / sa;
      q.g[k] = (p.g[i0] * a0 + p.g[i1] * a1 + p.g[i2] * a2 + p.g[i3] * a3) / sa;
      q.b[k] = (p.b[i0] * a0 + p.b[i1] * a1 + p.b[i2] * a2 + p.b[i3] * a3) / sa;
      q.a[k] = (sa - 0.04) / 4;
    }
    const cs = w / cells;
    if (cs >= 2) for (let i = 0; i < cells * cells; i++) {
      const cx = (i % cells) * cs, cy = Math.floor(i / cells) * cs;
      if (cover(q, cx, cy, cs, 1) >= target[i]) continue;
      let lo = 1, hi = 8;
      for (let it = 0; it < 9; it++) { const mid = (lo + hi) / 2; if (cover(q, cx, cy, cs, mid) < target[i]) lo = mid; else hi = mid; }
      for (let y = cy; y < cy + cs; y++) for (let x = cx; x < cx + cs; x++) { const k = y * w + x; q.a[k] = Math.min(255, q.a[k] * hi); }
    }
    levels.push(q);
  }
  // pack; transparent pixels take the (alpha-weighted) colour from two levels down,
  // so filtering at the edge of a needle never pulls in black
  const mips = levels.map((lv, li) => {
    const src2 = levels[Math.min(levels.length - 1, li + 2)];
    const out = new Uint8Array(lv.w * lv.w * 4);
    for (let y = 0; y < lv.w; y++) for (let x = 0; x < lv.w; x++) {
      const k = y * lv.w + x, o = k * 4;
      if (lv.a[k] > 8) { out[o] = lv.r[k]; out[o + 1] = lv.g[k]; out[o + 2] = lv.b[k]; }
      else { const j = (y >> 2) * src2.w + (x >> 2); out[o] = src2.r[j]; out[o + 1] = src2.g[j]; out[o + 2] = src2.b[j]; }
      out[o + 3] = Math.min(255, lv.a[k]);
    }
    return { data: out, width: lv.w, height: lv.w };
  });
  const tex = new THREE.DataTexture(mips[0].data, W0, W0, THREE.RGBAFormat);
  tex.mipmaps = mips as unknown as THREE.DataTexture["mipmaps"];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// --- bark ---------------------------------------------------------------------------------

export type BarkKind = "maple" | "birch" | "pine" | "spruce" | "oak";

export function barkTexture(kind: BarkKind): THREE.CanvasTexture {
  const W = 256, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(kind.length * 977);
  const base: Record<BarkKind, [number, number, number]> = {
    maple: [104, 100, 94], birch: [222, 218, 206], pine: [112, 78, 58], spruce: [96, 82, 70], oak: [84, 78, 72],
  };
  g.fillStyle = rgb(...base[kind]);
  g.fillRect(0, 0, W, H);
  if (kind === "birch") {
    // horizontal dark lenticels and black scars
    for (let i = 0; i < 140; i++) {
      g.fillStyle = rgb(40 + rnd() * 40, 36, 34, 0.55 + rnd() * 0.4);
      const x = rnd() * W, y = rnd() * H, w = 6 + rnd() * 30;
      g.fillRect(x, y, w, 1.5 + rnd() * 2.5);
      if (x + w > W) g.fillRect(x - W, y, w, 2);
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = rgb(30, 28, 26, 0.85);
      const x = rnd() * W, y = rnd() * H;
      g.beginPath(); g.ellipse(x, y, 10 + rnd() * 14, 5 + rnd() * 8, 0, 0, Math.PI * 2); g.fill();
    }
  } else {
    // vertical furrows / plates
    const ridges = kind === "pine" ? 7 : kind === "oak" ? 14 : kind === "spruce" ? 0 : 11;
    for (let i = 0; i < ridges; i++) {
      let x = (i / ridges) * W + rnd() * 8;
      for (let y = 0; y < H; y += 4) {
        x += (rnd() - 0.5) * 3;
        g.fillStyle = rgb(0, 0, 0, 0.25 + rnd() * 0.2);
        const xx = ((x % W) + W) % W;
        g.fillRect(xx, y, 3 + rnd() * 3, 5);
      }
    }
    // plates (pine) or scales (spruce)
    const plates = kind === "pine" ? 60 : kind === "spruce" ? 260 : 40;
    for (let i = 0; i < plates; i++) {
      const x = rnd() * W, y = rnd() * H;
      const w = kind === "pine" ? 20 + rnd() * 24 : kind === "spruce" ? 6 + rnd() * 8 : 8 + rnd() * 10;
      const h = kind === "pine" ? 30 + rnd() * 40 : kind === "spruce" ? 5 + rnd() * 6 : 30 + rnd() * 60;
      const k = 0.8 + rnd() * 0.4;
      g.fillStyle = rgb(base[kind][0] * k * 1.1, base[kind][1] * k * 1.08, base[kind][2] * k, 0.6);
      g.fillRect(x, y, w, h);
    }
    // lichen patches (grey-green) on the hardwoods
    if (kind === "maple" || kind === "oak") for (let i = 0; i < 18; i++) {
      g.fillStyle = rgb(140, 150, 120, 0.35);
      g.beginPath(); g.arc(rnd() * W, rnd() * H, 4 + rnd() * 10, 0, Math.PI * 2); g.fill();
    }
  }
  // fine grain noise
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
