// Magnetic declination from the World Magnetic Model (WMM2025).
// Positive = east, negative = west. Near Bancroft ON it's about -11 deg.
import * as geomagnetism from "geomagnetism";

export function declinationAt(lat: number, lon: number, date = new Date()): number {
  try {
    return geomagnetism.model(date).point([lat, lon]).decl;
  } catch {
    return 0;
  }
}
