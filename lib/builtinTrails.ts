// Trails that ship with the app, without putting the trail locations in the (public) code:
// lib/trails.enc.json is AES-256-GCM encrypted with a key derived (scrypt) from the party passcode.
// Only a server that has PARTY_PASSCODE can unlock it. Made by scripts/encrypt-trails.mjs.
// If the passcode is ever changed, these won't unlock (no error, just no built-in trails) until the
// file is re-made with the new passcode.
import { createDecipheriv, scryptSync } from "node:crypto";
import bundle from "./trails.enc.json";
import type { Trail } from "./store";

type Bundle = { v?: number; salt?: string; iv?: string; tag?: string; data?: string };
let cache: Trail[] | null = null;

export function trailKey(passcode: string, salt: Buffer): Buffer {
  return scryptSync(passcode.trim().toLowerCase(), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function builtinTrails(): Trail[] {
  if (cache) return cache;
  const b = bundle as Bundle;
  const pass = process.env.PARTY_PASSCODE;
  if (!pass || !b.data || !b.salt || !b.iv || !b.tag) return (cache = []);
  try {
    const d = createDecipheriv("aes-256-gcm", trailKey(pass, Buffer.from(b.salt, "base64")), Buffer.from(b.iv, "base64"));
    d.setAuthTag(Buffer.from(b.tag, "base64"));
    const json = Buffer.concat([d.update(Buffer.from(b.data, "base64")), d.final()]).toString("utf8");
    cache = (JSON.parse(json) as Trail[]).map((t) => ({ ...t, builtIn: true }));
  } catch {
    cache = []; // wrong passcode (it was changed since the file was made)
  }
  return cache;
}
