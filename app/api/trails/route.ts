// Trails imported from GPX files: GET all · POST one (already parsed in the browser).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addTrail, loadTrails, type Trail } from "@/lib/store";
import { builtinTrails } from "@/lib/builtinTrails";

const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });
const MAX_POINTS = 40000;

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  // the party's built-in trails (unlocked with the passcode) first, then imported ones
  const trails = [...builtinTrails(), ...(await loadTrails()).sort((a, b) => a.at - b.at)];
  return NextResponse.json({ trails });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const name = String(b.name ?? "").trim().slice(0, 80) || "Trail";
  const addedBy = String(b.addedBy ?? "").trim().slice(0, 40);
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color)) ? String(b.color) : "#ffd43b";
  const raw = Array.isArray(b.lines) ? b.lines : [];
  const lines: [number, number][][] = [];
  let n = 0;
  for (const l of raw) {
    if (!Array.isArray(l)) continue;
    const pts: [number, number][] = [];
    for (const p of l) {
      const lat = Number(Array.isArray(p) ? p[0] : NaN), lon = Number(Array.isArray(p) ? p[1] : NaN);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]);
    }
    if (pts.length > 1) { lines.push(pts); n += pts.length; }
  }
  if (!addedBy) return NextResponse.json({ error: "First name is required" }, { status: 400 });
  if (!lines.length) return NextResponse.json({ error: "No trail lines found in that file" }, { status: 400 });
  if (n > MAX_POINTS) return NextResponse.json({ error: "That trail file is too detailed" }, { status: 400 });
  const trail: Trail = { id: randomUUID(), name, color, lines, addedBy, at: Date.now() };
  await addTrail(trail);
  return NextResponse.json({ trail });
}
