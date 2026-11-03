import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addReport, clearReports, getInterval, hasDatabase, listReports } from "@/lib/store";
import { declinationAt } from "@/lib/declination";
import { norm360, type Report } from "@/lib/geo";

export const dynamic = "force-dynamic";
const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const [reports, intervalMin] = await Promise.all([listReports(), getInterval()]);
  return NextResponse.json({ reports, intervalMin, hasDatabase });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = String(b.name ?? "").trim().slice(0, 40);
  const lat = Number(b.lat), lon = Number(b.lon), bearing = Number(b.bearing), shotTime = Number(b.shotTime);
  const ref = b.bearingRef === "true" ? "true" : "magnetic";
  const accuracy = b.accuracy == null ? null : Number(b.accuracy);
  const now = Date.now();

  const errors: string[] = [];
  if (!name) errors.push("First name is required");
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) errors.push("Location is missing or invalid");
  if (!(bearing >= 0 && bearing <= 360)) errors.push("Bearing must be between 0 and 360");
  if (!(shotTime > now - 48 * 3600_000 && shotTime < now + 5 * 60_000)) errors.push("Time heard must be within the last 48 hours");
  if (errors.length) return NextResponse.json({ error: errors.join(". ") }, { status: 400 });

  const declination = ref === "magnetic" ? declinationAt(lat, lon, new Date(shotTime)) : 0;
  const report: Report = {
    id: randomUUID(), name, lat, lon,
    accuracy: accuracy != null && isFinite(accuracy) ? accuracy : null,
    bearingInput: norm360(bearing), bearingRef: ref, declination,
    bearingTrue: norm360(bearing + declination),
    shotTime, createdAt: now,
  };
  await addReport(report);
  return NextResponse.json({ report });
}

export async function DELETE() {
  if (!(await isAuthed())) return unauthorized();
  await clearReports();
  return NextResponse.json({ ok: true });
}
