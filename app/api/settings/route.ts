import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { setInterval } from "@/lib/store";

export async function PUT(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { intervalMin } = (await req.json().catch(() => ({}))) as { intervalMin?: number };
  const v = Number(intervalMin);
  if (!(v >= 0.25 && v <= 60)) return NextResponse.json({ error: "Interval must be 0.25-60 minutes" }, { status: 400 });
  await setInterval(v);
  return NextResponse.json({ intervalMin: v });
}
