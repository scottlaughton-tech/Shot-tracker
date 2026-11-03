// Shared party passcode. Set PARTY_PASSCODE in Vercel -> Settings -> Environment Variables.
import { createHash } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE = "shot_party";
const passcode = process.env.PARTY_PASSCODE?.trim();

export function tokenFor(code: string): string {
  return createHash("sha256").update(`shot-tracker:${code.trim().toLowerCase()}`).digest("hex");
}

/** "missing" = no passcode configured on a deployed site (we refuse to run open). */
export function authMode(): "ok" | "missing" | "dev-open" {
  if (passcode) return "ok";
  return process.env.NODE_ENV === "production" ? "missing" : "dev-open";
}

export function checkCode(code: string): boolean {
  return !!passcode && tokenFor(code) === tokenFor(passcode);
}

export async function isAuthed(): Promise<boolean> {
  const mode = authMode();
  if (mode === "dev-open") return true;
  if (mode === "missing") return false;
  const c = (await cookies()).get(COOKIE)?.value;
  return c === tokenFor(passcode!);
}
