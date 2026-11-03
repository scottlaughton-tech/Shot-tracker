import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { deleteReport } from "@/lib/store";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  await deleteReport(id);
  return NextResponse.json({ ok: true });
}
