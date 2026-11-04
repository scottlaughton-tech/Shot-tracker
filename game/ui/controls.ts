// How sliding a finger aims the scope. Saved on this phone only (each player picks their own).
export type AimSpeed = "slow" | "normal" | "fast";
export type Controls = {
  /** false: slide right and the scope aims right (like a mouse). true: the picture follows your finger. */
  dragView: boolean;
  speed: AimSpeed;
};

export const DEFAULT_CONTROLS: Controls = { dragView: false, speed: "normal" };
export const SPEED_FACTOR: Record<AimSpeed, number> = { slow: 0.6, normal: 1, fast: 1.6 };

const KEY = "st:game-controls";

export function loadControls(): Controls {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      return {
        dragView: v.dragView === true,
        speed: v.speed === "slow" || v.speed === "fast" ? v.speed : "normal",
      };
    }
  } catch {}
  return DEFAULT_CONTROLS;
}

export function saveControls(c: Controls) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}
