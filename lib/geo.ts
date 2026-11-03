// Geometry + triangulation helpers. No dependencies so it can run on the
// server, in the browser, and in unit tests.

export type Report = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  accuracy: number | null; // GPS accuracy in metres, if known
  bearingTrue: number; // degrees clockwise from TRUE north (what we draw)
  bearingInput: number; // what the person entered / captured
  bearingRef: "magnetic" | "true";
  declination: number; // degrees, east positive (applied if magnetic)
  shotTime: number; // epoch ms - when the shot was heard
  createdAt: number; // epoch ms - when the report was submitted
};

export type DeerType = "buck" | "doe" | "fawn" | "unknown";

export type Sighting = {
  id: string; // starts with "sight:"
  name: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  deer: DeerType;
  count: number;
  heading: number | null; // direction of travel, degrees TRUE; null = not moving
  headingInput: number | null;
  headingRef: "magnetic" | "true";
  declination: number;
  note: string;
  time: number; // epoch ms - when seen
  createdAt: number;
};

export type SignType = "ground-scrape" | "rub" | "droppings" | "tracks" | "bed";

export type Sign = {
  id: string; // starts with "sign:"
  name: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  sign: SignType;
  note: string;
  time: number;
  createdAt: number;
};

const R = 6371000; // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Point reached by travelling `dist` metres from (lat,lon) on `bearing` (true). */
export function destination(lat: number, lon: number, bearing: number, dist: number): [number, number] {
  const d = dist / R;
  const b = rad(bearing);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), deg(l2)];
}

/** Great-circle distance in metres. */
export function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dp = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial bearing (true, degrees) from point 1 to point 2. */
export function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(deg(Math.atan2(y, x)));
}

export function compassPoint(b: number): string {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round(norm360(b) / 22.5) % 16];
}

// ---------- Grouping reports into shots ----------

export type Shot = {
  key: string; // stable-ish id: id of first report
  index: number; // 0-based chronological order
  start: number;
  end: number;
  reports: Report[];
};

/**
 * Sort reports by time heard. A new shot starts with the earliest unassigned
 * report; any report heard within `intervalMin` minutes of that first report
 * belongs to the same shot.
 */
export function groupShots(reports: Report[], intervalMin: number): Shot[] {
  const sorted = [...reports].sort((a, b) => a.shotTime - b.shotTime);
  const shots: Shot[] = [];
  const windowMs = intervalMin * 60_000;
  for (const r of sorted) {
    const cur = shots[shots.length - 1];
    if (cur && r.shotTime - cur.start <= windowMs) {
      cur.reports.push(r);
      cur.end = r.shotTime;
    } else {
      shots.push({ key: r.id, index: shots.length, start: r.shotTime, end: r.shotTime, reports: [r] });
    }
  }
  return shots;
}

// ---------- Triangulation ----------

export type Fix = {
  lat: number;
  lon: number;
  /** 95% confidence ellipse: semi-axes in metres and orientation (deg, true, of major axis) */
  major: number;
  minor: number;
  orientation: number;
  /** Rough single-number uncertainty (metres) */
  radius: number;
  /** names of reporters whose line points AWAY from the estimate */
  behind: string[];
  used: number;
};

/** Assumed 1-sigma error of a bearing by ear + compass. */
export const BEARING_SIGMA_DEG = 5;

/**
 * Best estimate of where a set of bearing lines meet.
 * Weighted least squares: minimise sum of (perpendicular distance / expected error)^2,
 * where expected error grows with distance from the listener.
 */
export function triangulate(reports: Report[]): Fix | null {
  if (reports.length < 2) return null;

  // Local flat projection around the reporters' centroid (fine for < ~20 km).
  const lat0 = reports.reduce((s, r) => s + r.lat, 0) / reports.length;
  const lon0 = reports.reduce((s, r) => s + r.lon, 0) / reports.length;
  const kx = R * Math.cos(rad(lat0)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  const lines = reports.map((r) => {
    const b = rad(r.bearingTrue);
    return { r, px: (r.lon - lon0) * kx, py: (r.lat - lat0) * ky, dx: Math.sin(b), dy: Math.cos(b) };
  });

  const sigma = Math.tan(rad(BEARING_SIGMA_DEG));
  let weights = lines.map(() => 1);
  let x = 0;
  let y = 0;
  let inv: [number, number, number] = [0, 0, 0]; // inverse of A: [a, b, d] symmetric

  for (let iter = 0; iter < 6; iter++) {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    lines.forEach((l, i) => {
      const w = weights[i];
      // P = I - d d^T  (projects onto the line's normal)
      const p11 = 1 - l.dx * l.dx;
      const p12 = -l.dx * l.dy;
      const p22 = 1 - l.dy * l.dy;
      a11 += w * p11; a12 += w * p12; a22 += w * p22;
      b1 += w * (p11 * l.px + p12 * l.py);
      b2 += w * (p12 * l.px + p22 * l.py);
    });
    const det = a11 * a22 - a12 * a12;
    // Nearly parallel lines -> no meaningful intersection.
    const scale = (a11 + a22) ** 2;
    if (!(det > 1e-6 * scale)) return null;
    inv = [a22 / det, -a12 / det, a11 / det];
    x = inv[0] * b1 + inv[1] * b2;
    y = inv[1] * b1 + inv[2] * b2;
    // Update weights: expected perpendicular error = dist * tan(sigma)
    weights = lines.map((l) => {
      const along = Math.abs((x - l.px) * l.dx + (y - l.py) * l.dy);
      const s = Math.max(along, 100) * sigma;
      return 1 / (s * s);
    });
  }

  const behind: string[] = [];
  let chi2 = 0;
  lines.forEach((l, i) => {
    const along = (x - l.px) * l.dx + (y - l.py) * l.dy;
    if (along < 0) behind.push(l.r.name);
    const perp = (x - l.px) * -l.dy + (y - l.py) * l.dx;
    chi2 += weights[i] * perp * perp;
  });

  // Two lines that cross behind someone are not a real fix.
  if (reports.length === 2 && behind.length > 0) return null;

  // If lines disagree more than our assumed error, inflate the uncertainty.
  const dof = reports.length - 2;
  const inflate = dof > 0 ? Math.max(1, chi2 / dof) : 1;
  const c11 = inv[0] * inflate, c12 = inv[1] * inflate, c22 = inv[2] * inflate;

  // Eigen-decomposition of 2x2 covariance -> ellipse
  const tr = c11 + c22;
  const disc = Math.sqrt(Math.max(0, ((c11 - c22) / 2) ** 2 + c12 * c12));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 0);
  const k95 = Math.sqrt(5.991); // chi-square 2 dof, 95%
  const major = Math.sqrt(l1) * k95;
  const minor = Math.sqrt(l2) * k95;
  // angle of major axis measured from +x (east) counter-clockwise -> convert to compass
  const theta = 0.5 * Math.atan2(2 * c12, c11 - c22);
  const orientation = norm360(90 - deg(theta));

  const lat = lat0 + y / ky;
  const lon = lon0 + x / kx;

  // Reject absurd results (e.g. almost-parallel lines meeting 50 km away)
  const far = Math.max(...reports.map((r) => distance(r.lat, r.lon, lat, lon)));
  if (far > 20000) return null;

  return { lat, lon, major, minor, orientation, radius: Math.sqrt(major * minor), behind, used: reports.length };
}

/** Polygon (lat/lon) approximating the confidence ellipse, for drawing. */
export function ellipsePolygon(fix: Fix, steps = 48): [number, number][] {
  const pts: [number, number][] = [];
  const o = rad(fix.orientation);
  // unit vectors (east, north) for major/minor axes
  const mx = Math.sin(o), my = Math.cos(o);
  const nx = Math.cos(o), ny = -Math.sin(o);
  const kx = R * Math.cos(rad(fix.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  const a = Math.max(fix.major, 15);
  const b = Math.max(fix.minor, 15);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const ex = a * Math.cos(t) * mx + b * Math.sin(t) * nx;
    const ey = a * Math.cos(t) * my + b * Math.sin(t) * ny;
    pts.push([fix.lat + ey / ky, fix.lon + ex / kx]);
  }
  return pts;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
