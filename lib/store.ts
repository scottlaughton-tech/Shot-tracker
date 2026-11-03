// Data storage. Uses Upstash Redis when its environment variables exist
// (added automatically when you connect Upstash in the Vercel dashboard),
// otherwise an in-memory store for local testing.
import { Redis } from "@upstash/redis";
import type { Report } from "./geo";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const hasDatabase = !!redis;

const REPORTS = "shot-tracker:reports";
const INTERVAL = "shot-tracker:intervalMin";
const DEFAULT_INTERVAL = 2;

type Mem = { reports: Map<string, Report>; interval: number };
const g = globalThis as unknown as { __shotMem?: Mem };
const mem: Mem = (g.__shotMem ??= { reports: new Map(), interval: DEFAULT_INTERVAL });

export async function listReports(): Promise<Report[]> {
  if (!redis) return [...mem.reports.values()];
  const all = (await redis.hgetall<Record<string, Report | string>>(REPORTS)) ?? {};
  return Object.values(all).map((v) => (typeof v === "string" ? (JSON.parse(v) as Report) : v));
}

export async function addReport(r: Report): Promise<void> {
  if (!redis) return void mem.reports.set(r.id, r);
  await redis.hset(REPORTS, { [r.id]: JSON.stringify(r) });
}

export async function deleteReport(id: string): Promise<void> {
  if (!redis) return void mem.reports.delete(id);
  await redis.hdel(REPORTS, id);
}

export async function clearReports(): Promise<void> {
  if (!redis) return void mem.reports.clear();
  await redis.del(REPORTS);
}

export async function getInterval(): Promise<number> {
  if (!redis) return mem.interval;
  const v = await redis.get<number>(INTERVAL);
  return typeof v === "number" ? v : Number(v) || DEFAULT_INTERVAL;
}

export async function setInterval(min: number): Promise<void> {
  if (!redis) return void (mem.interval = min);
  await redis.set(INTERVAL, min);
}
