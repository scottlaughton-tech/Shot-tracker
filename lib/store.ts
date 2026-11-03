// Data storage. Uses Upstash Redis when its environment variables exist
// (added automatically when you connect Upstash in the Vercel dashboard),
// otherwise an in-memory store for local testing.
import { Redis } from "@upstash/redis";
import type { Blind, Report, Sighting, Sign } from "./geo";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const hasDatabase = !!redis;

// Everything lives in ONE hash so a refresh costs a single database command
// (the free plan allows 500k commands/month). The setting uses a reserved field.
const REPORTS = "shot-tracker:reports";
const SETTINGS_FIELD = "__settings";
const DEFAULT_INTERVAL = 2;

export const SIGHTING_PREFIX = "sight:";
export const SIGN_PREFIX = "sign:";
export const BLIND_PREFIX = "blind:";

type Entry = Report | Sighting | Sign | Blind;
type Mem = { reports: Map<string, Entry>; interval: number };
const g = globalThis as unknown as { __shotMem?: Mem };
const mem: Mem = (g.__shotMem ??= { reports: new Map(), interval: DEFAULT_INTERVAL });

export type AllData = { reports: Report[]; sightings: Sighting[]; signs: Sign[]; blinds: Blind[]; intervalMin: number };

/** Shot reports, deer sightings and the grouping interval, in one database read. */
export async function loadAll(): Promise<AllData> {
  const reports: Report[] = [];
  const sightings: Sighting[] = [];
  const signs: Sign[] = [];
  const blinds: Blind[] = [];
  let intervalMin = DEFAULT_INTERVAL;
  const put = (k: string, v: unknown) => {
    if (k === SETTINGS_FIELD) intervalMin = Number((v as { intervalMin?: number }).intervalMin) || DEFAULT_INTERVAL;
    else if (k.startsWith(SIGHTING_PREFIX)) sightings.push(v as Sighting);
    else if (k.startsWith(SIGN_PREFIX)) signs.push(v as Sign);
    else if (k.startsWith(BLIND_PREFIX)) blinds.push(v as Blind);
    else reports.push(v as Report);
  };
  if (!redis) {
    mem.reports.forEach((v, k) => put(k, v));
    return { reports, sightings, signs, blinds, intervalMin: mem.interval };
  }
  const all = (await redis.hgetall<Record<string, unknown>>(REPORTS)) ?? {};
  for (const [k, v] of Object.entries(all)) put(k, typeof v === "string" ? JSON.parse(v) : v);
  return { reports, sightings, signs, blinds, intervalMin };
}

export async function addReport(r: Entry): Promise<void> {
  if (!redis) return void mem.reports.set(r.id, r);
  await redis.hset(REPORTS, { [r.id]: JSON.stringify(r) });
}

export async function deleteReport(id: string): Promise<void> {
  if (id === SETTINGS_FIELD) return;
  if (!redis) return void mem.reports.delete(id);
  await redis.hdel(REPORTS, id);
}

/** Deletes every entry of one kind. Each kind is cleared separately; the setting is kept. */
export async function clearKind(kind: "shots" | "sightings" | "signs" | "blinds"): Promise<void> {
  const all = await loadAll();
  const lists = { shots: all.reports, sightings: all.sightings, signs: all.signs, blinds: all.blinds };
  const ids = lists[kind].map((r) => r.id);
  if (!ids.length) return;
  if (!redis) return void ids.forEach((id) => mem.reports.delete(id));
  await redis.hdel(REPORTS, ...ids);
}

export async function setInterval(min: number): Promise<void> {
  if (!redis) return void (mem.interval = min);
  await redis.hset(REPORTS, { [SETTINGS_FIELD]: JSON.stringify({ intervalMin: min }) });
}
