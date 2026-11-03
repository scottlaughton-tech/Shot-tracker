// High-contrast colours that stand out on a green/blue topo map.
export const SHOT_COLORS = [
  "#e6194b", "#f58231", "#911eb4", "#f032e6", "#111111",
  "#9a6324", "#4363d8", "#d4a017", "#800000", "#008080",
];
export const colorFor = (i: number) => SHOT_COLORS[i % SHOT_COLORS.length];

// Deer sighting markers (dashed arrows, so they look different from shot lines).
export const DEER_STYLE = {
  buck: { color: "#6b3e1f", letter: "B", label: "Buck" },
  doe: { color: "#c27c0e", letter: "D", label: "Doe" },
  fawn: { color: "#b5651d", letter: "F", label: "Fawn" },
  unknown: { color: "#555555", letter: "?", label: "Deer" },
} as const;

export function deerText(deer: keyof typeof DEER_STYLE, count: number): string {
  const l = DEER_STYLE[deer].label.toLowerCase();
  if (count === 1) return deer === "unknown" ? "a deer" : `a ${l}`;
  return `${count} ${deer === "unknown" ? "deer" : l === "buck" ? "bucks" : l === "doe" ? "does" : "fawns"}`;
}
