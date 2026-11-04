// DELETE one imported trail (for everyone in the party).
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { deleteTrail } from "@/lib/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = (await params).id;
  if (id.startsWith("builtin:")) return NextResponse.json({ error: "That trail is built into the app" }, { status: 400 });
  await deleteTrail(id);
  return NextResponse.json({ ok: true });
}
