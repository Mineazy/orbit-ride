// Street-following router over the road graph built by scripts/build-road-graph.mjs.
// Pure functions + a small A* implementation; no dependencies, so it also runs under plain Node.

export type LatLng = [number, number];

export interface RoadGraphData {
  v: number;
  scale: number;
  nodes: number[]; // delta-encoded [dLat, dLng, ...] in 1/scale degrees
  edges: number[]; // delta-encoded [dA, dB, ...] (a is a running sum, b is relative to a)
}

const M_PER_DEG_LAT = 111320;
const GRID_CELL = 0.002; // ~220 m

export const haversine = (a: LatLng, b: LatLng): number => {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const polylineLength = (pts: LatLng[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversine(pts[i - 1], pts[i]);
  return total;
};

const bearing = (a: LatLng, b: LatLng): number =>
  Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * (180 / Math.PI);

/**
 * Resample a polyline to about `count` points spaced evenly by distance along it (first/last kept).
 * Vertices where the road turns by more than `cornerDeg` are always kept, so the resampled path
 * follows street corners instead of cutting across them.
 */
export const resample = (pts: LatLng[], count: number, cornerDeg = 25): LatLng[] => {
  if (pts.length < 2 || count < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: count }, () => pts[0]);

  // distances (along the line) at which to emit a point: even spacing + sharp corners
  const targets = new Set<number>();
  for (let k = 0; k < count; k++) targets.add((total * k) / (count - 1));
  for (let i = 1; i < pts.length - 1; i++) {
    let turn = Math.abs(bearing(pts[i], pts[i + 1]) - bearing(pts[i - 1], pts[i]));
    if (turn > 180) turn = 360 - turn;
    if (turn > cornerDeg) targets.add(cum[i]);
  }
  const sorted = [...targets].sort((x, y) => x - y);

  const out: LatLng[] = [];
  let seg = 1;
  for (const target of sorted) {
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const span = cum[seg] - cum[seg - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[seg - 1]) / span));
    out.push([
      pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * t,
      pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * t,
    ]);
  }
  return out;
};

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    if (k.length) {
      k[0] = lastK;
      v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RoadRouter {
  readonly nodeCount: number;
  private lat: Float64Array;
  private lng: Float64Array;
  private adjStart: Int32Array;
  private adjTo: Int32Array;
  private adjLen: Float64Array;
  private grid = new Map<string, number[]>();
  private mPerDegLng: number;

  constructor(data: RoadGraphData) {
    const n = data.nodes.length / 2;
    this.nodeCount = n;
    this.lat = new Float64Array(n);
    this.lng = new Float64Array(n);
    let la = 0;
    let ln = 0;
    for (let i = 0; i < n; i++) {
      la += data.nodes[2 * i];
      ln += data.nodes[2 * i + 1];
      this.lat[i] = la / data.scale;
      this.lng[i] = ln / data.scale;
    }
    this.mPerDegLng = M_PER_DEG_LAT * Math.cos((this.lat[0] * Math.PI) / 180);

    // CSR adjacency (undirected)
    const m = data.edges.length / 2;
    const ea = new Int32Array(m);
    const eb = new Int32Array(m);
    const deg = new Int32Array(n + 1);
    let a = 0;
    for (let i = 0; i < m; i++) {
      a += data.edges[2 * i];
      ea[i] = a;
      eb[i] = a + data.edges[2 * i + 1];
      deg[ea[i] + 1]++;
      deg[eb[i] + 1]++;
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.adjStart = deg;
    this.adjTo = new Int32Array(2 * m);
    this.adjLen = new Float64Array(2 * m);
    const fill = deg.slice(0, n);
    for (let i = 0; i < m; i++) {
      const len = this.dist(ea[i], eb[i]);
      this.adjTo[fill[ea[i]]] = eb[i];
      this.adjLen[fill[ea[i]]++] = len;
      this.adjTo[fill[eb[i]]] = ea[i];
      this.adjLen[fill[eb[i]]++] = len;
    }

    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(this.lat[i] / GRID_CELL)},${Math.floor(this.lng[i] / GRID_CELL)}`;
      const cell = this.grid.get(key);
      if (cell) cell.push(i);
      else this.grid.set(key, [i]);
    }
  }

  private dist(a: number, b: number): number {
    const dy = (this.lat[a] - this.lat[b]) * M_PER_DEG_LAT;
    const dx = (this.lng[a] - this.lng[b]) * this.mPerDegLng;
    return Math.hypot(dx, dy);
  }

  coords(node: number): LatLng {
    return [this.lat[node], this.lng[node]];
  }

  /** Nearest road node within maxMeters, or -1. */
  snap(p: LatLng, maxMeters = 800): number {
    const ci = Math.floor(p[0] / GRID_CELL);
    const cj = Math.floor(p[1] / GRID_CELL);
    const rings = Math.ceil(maxMeters / (GRID_CELL * M_PER_DEG_LAT)) + 1;
    let best = -1;
    let bestD = maxMeters;
    for (let r = 0; r <= rings; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          for (const node of this.grid.get(`${ci + di},${cj + dj}`) || []) {
            const dy = (this.lat[node] - p[0]) * M_PER_DEG_LAT;
            const dx = (this.lng[node] - p[1]) * this.mPerDegLng;
            const d = Math.hypot(dx, dy);
            if (d < bestD) {
              bestD = d;
              best = node;
            }
          }
        }
      }
      // nothing in a closer ring can beat a hit that is already inside this ring's inner radius
      if (best !== -1 && bestD <= r * GRID_CELL * M_PER_DEG_LAT) break;
    }
    return best;
  }

  /** Closest point on the road network (a node), with the distance to it in metres. */
  nearestRoadPoint(p: LatLng, maxMeters = 800): { coords: LatLng; meters: number } | null {
    const n = this.snap(p, maxMeters);
    if (n === -1) return null;
    return { coords: this.coords(n), meters: haversine(p, this.coords(n)) };
  }

  /** Shortest street route between two arbitrary points, as a polyline along the roads. */
  route(from: LatLng, to: LatLng, maxSnapMeters = 800): LatLng[] | null {
    const s = this.snap(from, maxSnapMeters);
    const t = this.snap(to, maxSnapMeters);
    if (s === -1 || t === -1) return null;
    if (s === t) return [this.coords(s)];

    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const open = new MinHeap();
    const h = (v: number) => this.dist(v, t);
    g[s] = 0;
    open.push(h(s), s);

    while (open.size) {
      const u = open.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === t) break;
      for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) {
        const v = this.adjTo[e];
        const cand = g[u] + this.adjLen[e];
        if (cand < g[v]) {
          g[v] = cand;
          prev[v] = u;
          open.push(cand + h(v), v);
        }
      }
    }
    if (prev[t] === -1) return null;

    const path: LatLng[] = [];
    for (let v = t; v !== -1; v = prev[v]) path.push(this.coords(v));
    return path.reverse();
  }
}

let router: RoadRouter | null = null;
let loading: Promise<RoadRouter | null> | null = null;

/** Loads the road graph once; resolves to null (callers fall back to straight routes) if unavailable. */
export const loadRoadRouter = (url: string): Promise<RoadRouter | null> => {
  loading ??= fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<RoadGraphData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => (router = new RoadRouter(data)))
    .catch((err) => {
      console.warn('Road graph unavailable, vehicles will use straight-line routes:', err);
      return null;
    });
  return loading;
};

export const getRoadRouter = (): RoadRouter | null => router;
