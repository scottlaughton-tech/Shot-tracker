"use client";
// One shared phone compass for the whole app (quick shot screen, report form, map arrow).
// Headings are MAGNETIC, degrees clockwise from north, for the top edge of the phone.
// iPhone needs permission, which can only be requested from a tap: call startCompass() in a click handler.
import { useEffect, useState } from "react";

type Listener = (h: number | null) => void;
type Status = "ok" | "denied" | "unsupported";

const listeners = new Set<Listener>();
let started = false;
let heading: number | null = null;
let accuracy: number | null = null; // iPhone only: ± degrees, or -1 if it needs calibrating
let s = 0, c = 0, have = false;
let lastSent = 0;
let lastValue: number | null = null;
const GRANTED_KEY = "st:compass-ok";

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

function handler(e: Event) {
  const ev = e as OrientationEvt;
  let h: number | null = null;
  if (typeof ev.webkitCompassHeading === "number") {
    h = ev.webkitCompassHeading; // iPhone
    accuracy = typeof ev.webkitCompassAccuracy === "number" ? ev.webkitCompassAccuracy : null;
  } else if (ev.absolute && ev.alpha != null) {
    h = 360 - ev.alpha + (screen.orientation?.angle ?? 0); // Android
  }
  if (h == null || isNaN(h)) return;
  // smooth on the circle so 359° → 1° doesn't jump
  const r = (h * Math.PI) / 180;
  if (!have) { s = Math.sin(r); c = Math.cos(r); have = true; }
  else { s = s * 0.75 + Math.sin(r) * 0.25; c = c * 0.75 + Math.cos(r) * 0.25; }
  heading = (((Math.atan2(s, c) * 180) / Math.PI) + 360) % 360;
  // notify at most ~12×/s and only on a visible change
  const now = performance.now();
  if (now - lastSent < 80) return;
  if (lastValue != null && Math.abs(((heading - lastValue + 540) % 360) - 180) < 0.7) return;
  lastSent = now;
  lastValue = heading;
  listeners.forEach((l) => l(heading));
}

export function needsPermission(): boolean {
  if (typeof window === "undefined") return false;
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
  return !!DOE && typeof DOE.requestPermission === "function";
}

/** Was compass access granted on this phone before? (then a tap restarts it without a prompt) */
export function previouslyGranted(): boolean {
  try { return localStorage.getItem(GRANTED_KEY) === "1"; } catch { return false; }
}

/** Start listening for readings. Needs no permission: on Android readings flow right away;
 *  on iPhone they only arrive after startCompass() has been allowed. */
export function listenCompass() {
  if (started || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
  started = true;
  const ev = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(ev, handler);
}

/** Call from a tap. Asks for permission where the browser requires it (iPhone). */
export async function startCompass(): Promise<Status> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return "unsupported";
  listenCompass();
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    try {
      const r = await DOE.requestPermission();
      if (r === "denied") return "denied";
    } catch {
      // Some browsers throw when there's nothing to ask; readings (or their absence) will tell.
    }
  }
  try { localStorage.setItem(GRANTED_KEY, "1"); } catch {}
  return "ok";
}

export function compassAccuracy(): number | null {
  return accuracy;
}

/** Live magnetic heading (null until the first reading). */
export function useHeading(): number | null {
  const [h, setH] = useState<number | null>(heading);
  useEffect(() => {
    listeners.add(setH);
    setH(heading);
    return () => { listeners.delete(setH); };
  }, []);
  return h;
}
