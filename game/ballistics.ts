// Exterior ballistics for the game rifle: point-mass model with the standard G1 drag function.
// Pure math, no imports, so it runs in the browser and in `npm test`.
//
// Load: .308 Winchester, 150 gr soft point (Hornady American Whitetail class),
// 2820 fps muzzle velocity, G1 ballistic coefficient 0.338, scope 38 mm above the bore,
// zeroed at 200 m. The scope reticle's bullet-drop marks are computed from this file,
// so the marks and the real bullet in the game always agree.

export type Load = {
  name: string;
  /** muzzle velocity, m/s */
  mv: number;
  /** G1 ballistic coefficient (lb/in², the number printed on the ammo box) */
  bc: number;
  /** bullet mass, kg */
  mass: number;
  /** scope centre above the bore, m */
  sightHeight: number;
  /** distance where the bullet crosses the crosshair, m */
  zero: number;
};

export const LOAD_308: Load = {
  name: ".308 Win 150 gr",
  mv: 2820 * 0.3048,
  bc: 0.338,
  mass: 150 * 0.0000647989,
  sightHeight: 0.038,
  zero: 200,
};

export const GRAVITY = 9.80665;
export const SPEED_OF_SOUND = 337; // m/s at about 8 °C

// G1 retardation, piecewise power law in feet per second (the classic table used by
// most open-source solvers): retardation = A * v^M / BC  [ft/s²].
const G1: [number, number, number][] = [
  // [lower velocity bound (fps), A, M]
  [4230, 1.477404177730177e-4, 1.9565],
  [3680, 1.920339268755614e-4, 1.925],
  [3450, 2.894751026819746e-4, 1.875],
  [3295, 4.349905111115636e-4, 1.825],
  [3130, 6.520421871892662e-4, 1.775],
  [2960, 9.748073694078696e-4, 1.725],
  [2830, 1.453721560187286e-3, 1.675],
  [2680, 2.162887202930376e-3, 1.625],
  [2460, 3.209559783129881e-3, 1.575],
  [2225, 3.904368218691249e-3, 1.55],
  [2015, 3.222942271262336e-3, 1.575],
  [1890, 2.203329542297809e-3, 1.625],
  [1810, 1.511001028891904e-3, 1.675],
  [1730, 8.609957592468259e-4, 1.75],
  [1595, 4.086146797305117e-4, 1.85],
  [1520, 1.954473210037398e-4, 1.95],
  [1420, 5.431896266462351e-5, 2.125],
  [1360, 8.847742581674416e-6, 2.375],
  [1315, 1.456922328720298e-6, 2.625],
  [1280, 2.419485191895565e-7, 2.875],
  [1220, 1.657956321067612e-8, 3.25],
  [1185, 4.745469537157371e-10, 3.75],
  [1150, 1.379746590025088e-11, 4.25],
  [1100, 4.070157961147882e-13, 4.75],
  [1060, 2.938236954847331e-14, 5.125],
  [1025, 1.228597370774746e-14, 5.25],
  [980, 2.916938264100495e-14, 5.125],
  [945, 3.855099424807451e-13, 4.75],
  [905, 1.185097045689854e-11, 4.25],
  [860, 3.566129470974951e-10, 3.75],
  [810, 1.045513263966272e-8, 3.25],
  [780, 1.291159200846216e-7, 2.875],
  [750, 6.824429329105383e-7, 2.625],
  [700, 3.569169672385163e-6, 2.375],
  [640, 1.839015095899579e-5, 2.125],
  [600, 5.71117468873424e-5, 1.95],
  [550, 9.226557091973427e-5, 1.875],
  [250, 9.337991957131389e-5, 1.875],
  [100, 7.225247327590413e-5, 1.925],
  [65, 5.792684957074546e-5, 1.975],
  [0, 5.206214107320588e-5, 2.0],
];

/** G1 retardation for BC = 1, in ft/s², at a speed in ft/s. Exported for tests. */
export function g1Raw(vFps: number): number {
  for (const [lo, a, m] of G1) if (vFps > lo) return a * Math.pow(vFps, m);
  return 0;
}

/** Drag deceleration in m/s² for a bullet moving at v m/s. */
export function dragDecel(v: number, bc: number): number {
  return (g1Raw(v / 0.3048) / bc) * 0.3048;
}

/** Bullet state: position and velocity, metres and m/s, any right-handed frame with +y up. */
export type BulletState = { p: [number, number, number]; v: [number, number, number]; t: number };

/** Advance a bullet by dt seconds (midpoint method). Mutates and returns the state. */
export function stepBullet(s: BulletState, dt: number, bc: number): BulletState {
  const acc = (v: [number, number, number]): [number, number, number] => {
    const speed = Math.hypot(v[0], v[1], v[2]);
    const d = speed > 0 ? dragDecel(speed, bc) / speed : 0;
    return [-v[0] * d, -v[1] * d - GRAVITY, -v[2] * d];
  };
  const a1 = acc(s.v);
  const vm: [number, number, number] = [s.v[0] + a1[0] * dt / 2, s.v[1] + a1[1] * dt / 2, s.v[2] + a1[2] * dt / 2];
  const a2 = acc(vm);
  s.p[0] += vm[0] * dt; s.p[1] += vm[1] * dt; s.p[2] += vm[2] * dt;
  s.v[0] += a2[0] * dt; s.v[1] += a2[1] * dt; s.v[2] += a2[2] * dt;
  s.t += dt;
  return s;
}

const DT = 0.0005;

/** Flat-fire trajectory: height relative to the line of sight at each range (m, negative = below). */
function flight(load: Load, angle: number, maxRange: number, sample: (x: number, y: number, s: BulletState) => void) {
  const s: BulletState = { p: [0, -load.sightHeight, 0], v: [load.mv * Math.cos(angle), load.mv * Math.sin(angle), 0], t: 0 };
  let px = 0, py = s.p[1];
  while (s.p[0] < maxRange && s.t < 6) {
    px = s.p[0]; py = s.p[1];
    stepBullet(s, DT, load.bc);
    sample(px, py, s);
  }
}

const zeroCache = new Map<Load, number>();

/** Angle (radians) the bore points above the line of sight so the bullet crosses it at load.zero. */
export function zeroAngle(load: Load): number {
  const hit = zeroCache.get(load);
  if (hit != null) return hit;
  const heightAt = (angle: number) => {
    let y = 0;
    flight(load, angle, load.zero + 1, (px, py, s) => {
      if (px <= load.zero && s.p[0] >= load.zero) y = py + (s.p[1] - py) * ((load.zero - px) / (s.p[0] - px));
    });
    return y;
  };
  let lo = 0, hi = 0.02;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) > 0) hi = mid; else lo = mid;
  }
  const a = (lo + hi) / 2;
  zeroCache.set(load, a);
  return a;
}

export type TableRow = {
  range: number;
  /** bullet height relative to the crosshair, m (negative = below) */
  drop: number;
  /** how far to hold over, in milliradians (positive = aim higher) */
  holdMil: number;
  /** time of flight, s */
  tof: number;
  /** remaining speed, m/s */
  velocity: number;
  /** remaining energy, joules */
  energy: number;
};

/** Drop table for the given ranges (metres, ascending). */
export function dropTable(load: Load, ranges: number[]): TableRow[] {
  const rows: TableRow[] = [];
  const angle = zeroAngle(load);
  let i = 0;
  flight(load, angle, ranges[ranges.length - 1] + 1, (px, py, s) => {
    while (i < ranges.length && px <= ranges[i] && s.p[0] >= ranges[i]) {
      const f = (ranges[i] - px) / (s.p[0] - px);
      const drop = py + (s.p[1] - py) * f;
      const speed = Math.hypot(s.v[0], s.v[1]);
      rows.push({
        range: ranges[i], drop, holdMil: ranges[i] > 0 ? (-drop / ranges[i]) * 1000 : 0,
        tof: s.t - DT * (1 - f), velocity: speed, energy: 0.5 * load.mass * speed * speed,
      });
      i++;
    }
  });
  return rows;
}

/** Lead needed for a target crossing at `speed` m/s, in milliradians. */
export function leadMil(row: TableRow, speed: number): number {
  return ((speed * row.tof) / row.range) * 1000;
}
