// Data storage. Uses Upstash Redis when its environment variables exist
// (added automatically when you connect Upstash in the Vercel dashboard),
// otherwise an in-memory store for local testing.
import { Redis } from "@upstash/redis";
import type { Report } from "./geo";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const hasDatabase = !!redis;

// Everything lives in ONE hash so a refresh costs a single database command
// (the free plan allows 500k commands/month). The setting uses a reserved field.
const REPORTS = "shot-tracker:reports";
const SETTINGS_FIELD = "__settings";
const DEFAULT_INTERVAL = 2;

type Mem = { reports: Map<string, Report>; interval: number };
const g = globalThis as unknown as { __shotMem?: Mem };
const mem: Mem = (g.__shotMem ??= { reports: new Map(), interval: DEFAULT_INTERVAL });

/** Reports + shared grouping interval, in one database read. */
export async function loadAll(): Promise<{ reports: Report[]; intervalMin: number }> {
  if (!redis) return { reports: [...mem.reports.values()], intervalMin: mem.interval };
  const all = (await redis.hgetall<Record<string, unknown>>(REPORTS)) ?? {};
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  let intervalMin = DEFAULT_INTERVAL;
  const reports: Report[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (k === SETTINGS_FIELD) intervalMin = Number((parse(v) as { intervalMin?: number }).intervalMin) || DEFAULT_INTERVAL;
    else reports.push(parse(v) as Report);
  }
  return { reports, intervalMin };
}

export async function addReport(r: Report): Promise<void> {
  if (!redis) return void mem.reports.set(r.id, r);
  await redis.hset(REPORTS, { [r.id]: JSON.stringify(r) });
}

export async function deleteReport(id: string): Promise<void> {
  if (id === SETTINGS_FIELD) return;
  if (!redis) return void mem.reports.delete(id);
  await redis.hdel(REPORTS, id);
}

/** Deletes every report but keeps the interval setting. */
export async function clearReports(): Promise<void> {
  if (!redis) return void mem.reports.clear();
  const { intervalMin } = await loadAll();
  await redis.del(REPORTS);
  await setInterval(intervalMin);
}

export async function setInterval(min: number): Promise<void> {
  if (!redis) return void (mem.interval = min);
  await redis.hset(REPORTS, { [SETTINGS_FIELD]: JSON.stringify({ intervalMin: min }) });
}
