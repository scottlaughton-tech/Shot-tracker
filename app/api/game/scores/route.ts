// Shared leaderboard for the hunting game (Last Light).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { addScore, topScores, type GameMode, type GameScore } from "@/lib/store";

const unauthorized = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

const modeOf = (v: unknown): GameMode => (v === "turbo" ? "turbo" : "classic");

export async function GET(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const mode = modeOf(new URL(req.url).searchParams.get("mode"));
  return NextResponse.json({ mode, scores: await topScores(20, mode) });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const name = String(b.name ?? "").trim().slice(0, 40);
  const score = Math.round(Number(b.score));
  const kills = Math.round(Number(b.kills));
  const shots = Math.round(Number(b.shots));
  const best = b.best == null ? null : String(b.best).slice(0, 80);
  const level = Math.round(Number(b.level ?? 1));
  const mode = modeOf(b.mode);
  if (!name) return NextResponse.json({ error: "First name is required" }, { status: 400 });
  if (!isFinite(score) || score < -5000 || score > 200000 || !(kills >= 0 && kills <= 300) || !(shots >= 0 && shots <= 3000) || !(level >= 1 && level <= 301)) {
    return NextResponse.json({ error: "That score doesn't look right" }, { status: 400 });
  }
  const entry: GameScore = { id: randomUUID(), name, score, kills, shots, level, mode, best, at: Date.now() };
  await addScore(entry);
  const scores = await topScores(20, mode);
  return NextResponse.json({ entry, scores, rank: scores.findIndex((s) => s.id === entry.id) + 1 || null });
}
