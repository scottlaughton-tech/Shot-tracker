// High-contrast colours that stand out on a green/blue topo map.
export const SHOT_COLORS = [
  "#e6194b", "#f58231", "#911eb4", "#f032e6", "#111111",
  "#9a6324", "#4363d8", "#d4a017", "#800000", "#008080",
];
export const colorFor = (i: number) => SHOT_COLORS[i % SHOT_COLORS.length];
