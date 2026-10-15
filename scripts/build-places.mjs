// Builds a searchable place index (named places, businesses, suburbs and streets) from the same Protomaps tiles the
// map draws, so search results always match what people see. No network or API key needed.
//
//   npm run build:places
//
// Output: public/tiles/windhoek-places.json   { v, places: [[name, kind, lat, lng], ...] }  (kind: see KIND_LABELS)

import fs from 'node:fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const SRC = 'public/tiles/windhoek.pmtiles';
const OUT = 'public/tiles/windhoek-places.json';
const Z = 15;
const [MIN_LAT, MAX_LAT, MIN_LNG, MAX_LNG] = [-22.66, -22.49, 17.0, 17.14];

// POI kinds that are not useful destinations
const SKIP_POI = new Set(['parking', 'residential', 'atm', 'bus_stop', 'bicycle_parking', 'toilets', 'bench', 'post_box']);
const ROAD_KINDS = new Set(['highway', 'major_road', 'minor_road']);
const SKIP_ROAD_DETAIL = new Set(['driveway', 'parking_aisle', 'raceway', 'pedestrian', 'path', 'track', 'footway', 'cycleway', 'steps']);

const buf = fs.readFileSync(SRC);
const pm = new PMTiles({
  getKey: () => SRC,
  getBytes: async (offset, length) => ({ data: buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + length) }),
});

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z);
};
const tileToLng = (x, px, extent) => ((x + px / extent) / 2 ** Z) * 360 - 180;
const tileToLat = (y, py, extent) => {
  const n = Math.PI - (2 * Math.PI * (y + py / extent)) / 2 ** Z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const named = new Map(); // key -> [name, kind, lat, lng]
const streets = new Map(); // street name -> list of [lat, lng] vertices
const inBox = (lat, lng) => lat >= MIN_LAT && lat <= MAX_LAT && lng >= MIN_LNG && lng <= MAX_LNG;
const cleanName = (s) => String(s).replace(/\s+/g, ' ').trim();

for (let x = lon2x(MIN_LNG); x <= lon2x(MAX_LNG); x++) {
  for (let y = lat2y(MAX_LAT); y <= lat2y(MIN_LAT); y++) {
    const tile = await pm.getZxy(Z, x, y);
    if (!tile) continue;
    const layers = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers;

    for (const [layerName, kindOf] of [['pois', (p) => p.kind], ['places', (p) => (p.kind === 'neighbourhood' ? 'suburb' : p.kind)]]) {
      const layer = layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const p = f.properties;
        if (!p.name || f.type !== 1) continue;
        const kind = kindOf(p);
        if (!kind || (layerName === 'pois' && SKIP_POI.has(kind))) continue;
        const pt = f.loadGeometry()[0][0];
        const lat = tileToLat(y, pt.y, layer.extent);
        const lng = tileToLng(x, pt.x, layer.extent);
        if (!inBox(lat, lng)) continue;
        const name = cleanName(p.name);
        const key = `${name.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
        if (!named.has(key)) named.set(key, [name, kind, +lat.toFixed(5), +lng.toFixed(5)]);
      }
    }

    const roads = layers.roads;
    if (roads) {
      for (let i = 0; i < roads.length; i++) {
        const f = roads.feature(i);
        const p = f.properties;
        if (f.type !== 2 || !p.name || !ROAD_KINDS.has(p.kind) || SKIP_ROAD_DETAIL.has(p.kind_detail)) continue;
        const name = cleanName(p.name);
        const pts = streets.get(name) ?? [];
        for (const part of f.loadGeometry()) {
          for (const pt of part) {
            const lat = tileToLat(y, pt.y, roads.extent);
            const lng = tileToLng(x, pt.x, roads.extent);
            if (inBox(lat, lng)) pts.push([lat, lng]);
          }
        }
        streets.set(name, pts);
      }
    }
  }
}

// A street becomes one search result: the vertex closest to the middle of all its vertices (so the point is ON the road).
// Streets sharing a name in different suburbs are rare enough that one entry is fine; the nearest suburb is added later.
for (const [name, pts] of streets) {
  if (!pts.length) continue;
  const cLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cLng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best = pts[0];
  let bestD = Infinity;
  for (const p of pts) {
    const d = (p[0] - cLat) ** 2 + (p[1] - cLng) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  named.set(`street|${name.toLowerCase()}`, [name, 'street', +best[0].toFixed(5), +best[1].toFixed(5)]);
}

const places = [...named.values()].sort((a, b) => a[0].localeCompare(b[0]));
fs.writeFileSync(OUT, JSON.stringify({ v: 1, places }));
const byKind = {};
for (const p of places) byKind[p[1]] = (byKind[p[1]] || 0) + 1;
console.log(`${places.length} places written to ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log(Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join('  '));
