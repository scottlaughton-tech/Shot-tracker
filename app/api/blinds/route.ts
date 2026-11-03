import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addReport, BLIND_PREFIX, clearKind } from "@/lib/store";
import type { Blind, BlindType } from "@/lib/geo";

const TYPES: BlindType[] = ["tree-stand", "ladder-stand", "ground-blind", "box-blind", "other"];
const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = String(b.name ?? "").trim().slice(0, 40);
  const title = String(b.title ?? "").trim().slice(0, 40);
  const lat = Number(b.lat), lon = Number(b.lon);
  const accuracy = b.accuracy == null ? null : Number(b.accuracy);
  const note = String(b.note ?? "").trim().slice(0, 120);
  const blind = TYPES.includes(b.blind as BlindType) ? (b.blind as BlindType) : "other";
  const now = Date.now();

  const errors: string[] = [];
  if (!name) errors.push("First name is required");
  if (!title) errors.push("Give the blind a name");
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) errors.push("Location is missing or invalid");
  if (errors.length) return NextResponse.json({ error: errors.join(". ") }, { status: 400 });

  const entry: Blind = {
    id: BLIND_PREFIX + randomUUID(), name, title, lat, lon,
    accuracy: accuracy != null && isFinite(accuracy) ? accuracy : null,
    blind, note, time: now, createdAt: now,
  };
  await addReport(entry);
  return NextResponse.json({ blind: entry });
}

export async function DELETE() {
  if (!(await isAuthed())) return unauthorized();
  await clearKind("blinds");
  return NextResponse.json({ ok: true });
}
