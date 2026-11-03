import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addReport, clearKind, SIGN_PREFIX } from "@/lib/store";
import type { Sign, SignType } from "@/lib/geo";

const TYPES: SignType[] = ["ground-scrape", "rub", "droppings", "tracks", "bed"];
const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = String(b.name ?? "").trim().slice(0, 40);
  const lat = Number(b.lat), lon = Number(b.lon);
  const accuracy = b.accuracy == null ? null : Number(b.accuracy);
  const note = String(b.note ?? "").trim().slice(0, 120);
  const now = Date.now();

  const errors: string[] = [];
  if (!name) errors.push("First name is required");
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) errors.push("Location is missing or invalid");
  if (!TYPES.includes(b.sign as SignType)) errors.push("Choose a type of sign");
  if (errors.length) return NextResponse.json({ error: errors.join(". ") }, { status: 400 });

  const sign: Sign = {
    id: SIGN_PREFIX + randomUUID(), name, lat, lon,
    accuracy: accuracy != null && isFinite(accuracy) ? accuracy : null,
    sign: b.sign as SignType, note, time: now, createdAt: now,
  };
  await addReport(sign);
  return NextResponse.json({ sign });
}

export async function DELETE() {
  if (!(await isAuthed())) return unauthorized();
  await clearKind("signs");
  return NextResponse.json({ ok: true });
}
