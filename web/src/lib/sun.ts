// Day/night terminator: the night half of the Earth as a GeoJSON polygon for a given instant.
// NOAA-style low-precision solar position (well under 1 degree of error), enough for a live map overlay.

export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (date.getUTCHours() - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  return { lat: decl / rad, lon: -(minutes + eqTime - 720) / 4 };
}

export function nightPolygon(date = new Date()) {
  const rad = Math.PI / 180;
  const sun = subsolarPoint(date);
  const decl = Math.abs(sun.lat) < 0.1 ? 0.1 * Math.sign(sun.lat || 1) : sun.lat; // avoid tan(0) at the equinox
  const line: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    line.push([lon, Math.atan(-Math.cos((lon - sun.lon) * rad) / Math.tan(decl * rad)) / rad]);
  }
  const pole = decl > 0 ? -90 : 90; // the pole tilted away from the sun is in night
  const ring: [number, number][] = [...line, [180, pole], [-180, pole], line[0]];
  return { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [ring] }, properties: {} };
}
