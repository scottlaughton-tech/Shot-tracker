import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addReport, clearSightings, SIGHTING_PREFIX } from "@/lib/store";
import { declinationAt } from "@/lib/declination";
import { norm360, type DeerType, type Sighting } from "@/lib/geo";

const DEER: DeerType[] = ["buck", "doe", "fawn", "unknown"];
const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = String(b.name ?? "").trim().slice(0, 40);
  const lat = Number(b.lat), lon = Number(b.lon), time = Number(b.time);
  const deer = DEER.includes(b.deer as DeerType) ? (b.deer as DeerType) : "unknown";
  const count = Math.round(Number(b.count) || 1);
  const ref = b.headingRef === "true" ? "true" : "magnetic";
  const headingIn = b.heading == null || b.heading === "" ? null : Number(b.heading);
  const accuracy = b.accuracy == null ? null : Number(b.accuracy);
  const note = String(b.note ?? "").trim().slice(0, 120);
  const now = Date.now();

  const errors: string[] = [];
  if (!name) errors.push("First name is required");
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) errors.push("Location is missing or invalid");
  if (headingIn != null && !(headingIn >= 0 && headingIn <= 360)) errors.push("Direction must be between 0 and 360");
  if (!(count >= 1 && count <= 50)) errors.push("Count must be 1-50");
  if (!(time > now - 48 * 3600_000 && time < now + 5 * 60_000)) errors.push("Time seen must be within the last 48 hours");
  if (errors.length) return NextResponse.json({ error: errors.join(". ") }, { status: 400 });

  const declination = headingIn != null && ref === "magnetic" ? declinationAt(lat, lon, new Date(time)) : 0;
  const sighting: Sighting = {
    id: SIGHTING_PREFIX + randomUUID(), name, lat, lon,
    accuracy: accuracy != null && isFinite(accuracy) ? accuracy : null,
    deer, count, note,
    headingInput: headingIn == null ? null : norm360(headingIn),
    headingRef: ref, declination,
    heading: headingIn == null ? null : norm360(headingIn + declination),
    time, createdAt: now,
  };
  await addReport(sighting);
  return NextResponse.json({ sighting });
}

export async function DELETE() {
  if (!(await isAuthed())) return unauthorized();
  await clearSightings();
  return NextResponse.json({ ok: true });
}
