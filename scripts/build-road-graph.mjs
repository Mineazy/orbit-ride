// Builds a compact drivable road graph from the Protomaps tiles in public/tiles/windhoek.pmtiles.
// The browser router (src/utils/roadRouter.ts) uses it so simulated vehicles follow real streets.
//
//   npm run build:roads
//
// Output: public/tiles/windhoek-roads.json  (delta-encoded integer coordinates, see decode in roadRouter.ts)

import fs from 'node:fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const SRC = 'public/tiles/windhoek.pmtiles';
const OUT = 'public/tiles/windhoek-roads.json';
const Z = 15; // highest zoom in the extract, full road detail
const SCALE = 1e6; // stored coordinate precision: 1e-6 degrees (~0.11 m)
const MERGE_METERS = 1.5; // vertices closer than this are the same junction (tile seams quantise differently)

// Urban Windhoek, with margin around every WINDHOEK_LOCATIONS entry
const [MIN_LAT, MAX_LAT, MIN_LNG, MAX_LNG] = [-22.66, -22.49, 17.0, 17.14];

// Road classes a car can use. Service roads/driveways are mostly parking aisles, so they are left out.
const DRIVABLE_KINDS = new Set(['highway', 'major_road', 'minor_road']);
const EXCLUDED_DETAIL = new Set(['driveway', 'parking_aisle', 'raceway', 'pedestrian']);

const buf = fs.readFileSync(SRC);
const pm = new PMTiles({
  getKey: () => SRC,
  getBytes: async (offset, length) => ({
    data: buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + length),
  }),
});

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};
const tileToLng = (x, px, extent) => ((x + px / extent) / 2 ** Z) * 360 - 180;
const tileToLat = (y, py, extent) => {
  const n = Math.PI - (2 * Math.PI * (y + py / extent)) / 2 ** Z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// 1. Collect road polylines
const lines = [];
for (let x = lon2x(MIN_LNG); x <= lon2x(MAX_LNG); x++) {
  for (let y = lat2y(MAX_LAT); y <= lat2y(MIN_LAT); y++) {
    const tile = await pm.getZxy(Z, x, y);
    if (!tile) continue;
    const roads = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers.roads;
    if (!roads) continue;
    for (let i = 0; i < roads.length; i++) {
      const f = roads.feature(i);
      if (f.type !== 2) continue;
      const { kind, kind_detail: detail } = f.properties;
      if (!DRIVABLE_KINDS.has(kind) || EXCLUDED_DETAIL.has(detail)) continue;
      for (const part of f.loadGeometry()) {
        if (part.length < 2) continue;
        lines.push(part.map((p) => [tileToLat(y, p.y, roads.extent), tileToLng(x, p.x, roads.extent)]));
      }
    }
  }
}

// 2. Merge near-identical vertices into junction nodes (union-find over a spatial hash)
const verts = lines.flat();
const parent = Int32Array.from({ length: verts.length }, (_, i) => i);
const find = (a) => {
  while (parent[a] !== a) {
    parent[a] = parent[parent[a]];
    a = parent[a];
  }
  return a;
};
const union = (a, b) => {
  a = find(a);
  b = find(b);
  if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
};
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((-22.56 * Math.PI) / 180);
const cellLat = (MERGE_METERS * 2) / M_PER_DEG_LAT;
const cellLng = (MERGE_METERS * 2) / mPerDegLng;
const grid = new Map();
verts.forEach(([lat, lng], i) => {
  const ci = Math.floor(lat / cellLat);
  const cj = Math.floor(lng / cellLng);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(`${ci + di},${cj + dj}`) || []) {
        const dy = (verts[j][0] - lat) * M_PER_DEG_LAT;
        const dx = (verts[j][1] - lng) * mPerDegLng;
        if (dx * dx + dy * dy <= MERGE_METERS * MERGE_METERS) union(i, j);
      }
    }
  }
  const key = `${ci},${cj}`;
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(i);
});

// 3. Nodes (cluster centroids) and de-duplicated edges
const nodeOfRoot = new Map();
const sums = [];
const nodeOf = new Int32Array(verts.length);
verts.forEach(([lat, lng], i) => {
  const r = find(i);
  if (!nodeOfRoot.has(r)) {
    nodeOfRoot.set(r, sums.length);
    sums.push([0, 0, 0]);
  }
  const n = nodeOfRoot.get(r);
  nodeOf[i] = n;
  sums[n][0] += lat;
  sums[n][1] += lng;
  sums[n][2]++;
});
const edgeSet = new Set();
let cursor = 0;
for (const line of lines) {
  for (let k = 0; k < line.length - 1; k++) {
    const a = nodeOf[cursor + k];
    const b = nodeOf[cursor + k + 1];
    if (a !== b) edgeSet.add(a < b ? a * 4294967296 + b : b * 4294967296 + a);
  }
  cursor += line.length;
}
let edges = [...edgeSet].map((e) => [Math.floor(e / 4294967296), e % 4294967296]);

// 3b. Side roads often end exactly on a main road with no shared vertex (the main road's junction vertex
// was simplified away). Connect each dead end to the nearest road segment within SNAP_METERS by splitting
// that segment at the projection point.
const SNAP_METERS = 6;
const pos = sums.map(([la, ln, c]) => [la / c, ln / c]);
const degree = new Int32Array(pos.length);
edges.forEach(([a, b]) => {
  degree[a]++;
  degree[b]++;
});
const segs = edges.map(([a, b]) => ({ a, b, alive: true }));
const segGrid = new Map();
const SEG_CELL = 0.0004; // ~44 m
const cellsOf = (la1, ln1, la2, ln2) => {
  const out = [];
  const i0 = Math.floor((Math.min(la1, la2) - SNAP_METERS / M_PER_DEG_LAT) / SEG_CELL);
  const i1 = Math.floor((Math.max(la1, la2) + SNAP_METERS / M_PER_DEG_LAT) / SEG_CELL);
  const j0 = Math.floor((Math.min(ln1, ln2) - SNAP_METERS / mPerDegLng) / SEG_CELL);
  const j1 = Math.floor((Math.max(ln1, ln2) + SNAP_METERS / mPerDegLng) / SEG_CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(`${i},${j}`);
  return out;
};
const indexSeg = (id) => {
  const { a, b } = segs[id];
  for (const k of cellsOf(pos[a][0], pos[a][1], pos[b][0], pos[b][1])) {
    if (!segGrid.has(k)) segGrid.set(k, []);
    segGrid.get(k).push(id);
  }
};
segs.forEach((_, id) => indexSeg(id));

let snapped = 0;
const deadEnds = [];
degree.forEach((d, n) => d === 1 && deadEnds.push(n));
const newEdges = [];
for (const p of deadEnds) {
  const [pla, pln] = pos[p];
  const cell = `${Math.floor(pla / SEG_CELL)},${Math.floor(pln / SEG_CELL)}`;
  let best = null;
  for (const id of segGrid.get(cell) || []) {
    const sg = segs[id];
    if (!sg.alive || sg.a === p || sg.b === p) continue;
    const [la, lna] = pos[sg.a];
    const [lb, lnb] = pos[sg.b];
    // project p onto the segment in local metres
    const ax = (lna - pln) * mPerDegLng, ay = (la - pla) * M_PER_DEG_LAT;
    const bx = (lnb - pln) * mPerDegLng, by = (lb - pla) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const dist = Math.hypot(qx, qy);
    if (dist <= SNAP_METERS && (!best || dist < best.dist)) best = { id, t, dist };
  }
  if (!best) continue;
  const sg = segs[best.id];
  snapped++;
  // Reuse an end node when the projection lands next to it, otherwise split the segment
  const lenAB = Math.hypot((pos[sg.b][1] - pos[sg.a][1]) * mPerDegLng, (pos[sg.b][0] - pos[sg.a][0]) * M_PER_DEG_LAT);
  let q;
  if (best.t * lenAB < MERGE_METERS * 2) q = sg.a;
  else if ((1 - best.t) * lenAB < MERGE_METERS * 2) q = sg.b;
  else {
    q = pos.length;
    pos.push([pos[sg.a][0] + (pos[sg.b][0] - pos[sg.a][0]) * best.t, pos[sg.a][1] + (pos[sg.b][1] - pos[sg.a][1]) * best.t]);
    sums.push([pos[q][0], pos[q][1], 1]);
    const { a, b } = sg;
    sg.alive = false;
    segs.push({ a, b: q, alive: true }, { a: q, b, alive: true });
    indexSeg(segs.length - 2);
    indexSeg(segs.length - 1);
  }
  newEdges.push([p, q]);
}
edges = segs.filter((sg) => sg.alive).map((sg) => [sg.a, sg.b]).concat(newEdges);
console.log(`snapped ${snapped} of ${deadEnds.length} dead ends onto passing roads`);

// 4. Keep only the largest connected component so every node can reach every other
const comp = new Int32Array(sums.length).fill(-1);
const adj = Array.from({ length: sums.length }, () => []);
edges.forEach(([a, b]) => {
  adj[a].push(b);
  adj[b].push(a);
});
let best = { id: -1, size: 0 };
let compCount = 0;
for (let s = 0; s < sums.length; s++) {
  if (comp[s] !== -1) continue;
  const stack = [s];
  comp[s] = compCount;
  let size = 0;
  while (stack.length) {
    const v = stack.pop();
    size++;
    for (const w of adj[v]) {
      if (comp[w] === -1) {
        comp[w] = compCount;
        stack.push(w);
      }
    }
  }
  if (size > best.size) best = { id: compCount, size };
  compCount++;
}
const remap = new Int32Array(sums.length).fill(-1);
const keep = [];
for (let n = 0; n < sums.length; n++) {
  if (comp[n] === best.id) {
    remap[n] = keep.length;
    keep.push(n);
  }
}
const keptEdges = edges.filter(([a]) => comp[a] === best.id).map(([a, b]) => [remap[a], remap[b]]);

// 5. Delta-encode (nodes stay spatially coherent because they were created in tile/feature order)
const nodes = [];
let pLat = 0;
let pLng = 0;
for (const n of keep) {
  const lat = Math.round((sums[n][0] / sums[n][2]) * SCALE);
  const lng = Math.round((sums[n][1] / sums[n][2]) * SCALE);
  nodes.push(lat - pLat, lng - pLng);
  pLat = lat;
  pLng = lng;
}
keptEdges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const edgeFlat = [];
let pa = 0;
for (const [a, b] of keptEdges) {
  edgeFlat.push(a - pa, b - a);
  pa = a;
}

fs.writeFileSync(OUT, JSON.stringify({ v: 1, scale: SCALE, nodes, edges: edgeFlat }));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(
  `${lines.length} road lines, ${verts.length} vertices -> ${sums.length} nodes in ${compCount} components; ` +
    `kept largest: ${keep.length} nodes (${((100 * keep.length) / sums.length).toFixed(1)}%), ${keptEdges.length} edges -> ${OUT} (${kb} kB)`
);
