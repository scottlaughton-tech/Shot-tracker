// Data storage. Uses Upstash Redis when its environment variables exist
// (added automatically when you connect Upstash in the Vercel dashboard),
// otherwise an in-memory store for local testing.
import { Redis } from "@upstash/redis";
import type { Report, Sighting } from "./geo";

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

type Mem = { reports: Map<string, Report | Sighting>; interval: number };
const g = globalThis as unknown as { __shotMem?: Mem };
const mem: Mem = (g.__shotMem ??= { reports: new Map(), interval: DEFAULT_INTERVAL });

export type AllData = { reports: Report[]; sightings: Sighting[]; intervalMin: number };

/** Shot reports, deer sightings and the grouping interval, in one database read. */
export async function loadAll(): Promise<AllData> {
  const reports: Report[] = [];
  const sightings: Sighting[] = [];
  let intervalMin = DEFAULT_INTERVAL;
  const put = (k: string, v: unknown) => {
    if (k === SETTINGS_FIELD) intervalMin = Number((v as { intervalMin?: number }).intervalMin) || DEFAULT_INTERVAL;
    else if (k.startsWith(SIGHTING_PREFIX)) sightings.push(v as Sighting);
    else reports.push(v as Report);
  };
  if (!redis) {
    mem.reports.forEach((v, k) => put(k, v));
    return { reports, sightings, intervalMin: mem.interval };
  }
  const all = (await redis.hgetall<Record<string, unknown>>(REPORTS)) ?? {};
  for (const [k, v] of Object.entries(all)) put(k, typeof v === "string" ? JSON.parse(v) : v);
  return { reports, sightings, intervalMin };
}

export async function addReport(r: Report | Sighting): Promise<void> {
  if (!redis) return void mem.reports.set(r.id, r);
  await redis.hset(REPORTS, { [r.id]: JSON.stringify(r) });
}

export async function deleteReport(id: string): Promise<void> {
  if (id === SETTINGS_FIELD) return;
  if (!redis) return void mem.reports.delete(id);
  await redis.hdel(REPORTS, id);
}

/** Deletes every shot report (keeps deer sightings and the interval setting). */
export async function clearReports(): Promise<void> {
  const { reports } = await loadAll();
  if (!reports.length) return;
  if (!redis) return void reports.forEach((r) => mem.reports.delete(r.id));
  await redis.hdel(REPORTS, ...reports.map((r) => r.id));
}

/** Deletes every deer sighting. */
export async function clearSightings(): Promise<void> {
  const { sightings } = await loadAll();
  if (!sightings.length) return;
  if (!redis) return void sightings.forEach((r) => mem.reports.delete(r.id));
  await redis.hdel(REPORTS, ...sightings.map((r) => r.id));
}

export async function setInterval(min: number): Promise<void> {
  if (!redis) return void (mem.interval = min);
  await redis.hset(REPORTS, { [SETTINGS_FIELD]: JSON.stringify({ intervalMin: min }) });
}
