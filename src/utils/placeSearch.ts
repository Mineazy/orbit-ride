// Address and place search over the index built by scripts/build-places.mjs.
// Pure functions (no browser APIs) so they run under plain Node in the tests; the fetch lives in loadPlaceIndex.

export type LatLng = [number, number];

export interface Place {
  name: string;
  kind: string;
  coords: LatLng;
  /** Short description for the result list, e.g. "Shopping" or "Street" */
  label: string;
}

type RawPlace = [string, string, number, number];

interface Entry extends Place {
  norm: string;
  words: string[];
  weight: number;
}

export interface PlaceIndex {
  entries: Entry[];
}

const KIND_LABELS: Record<string, string> = {
  street: 'Street', suburb: 'Suburb', neighbourhood: 'Suburb', mall: 'Mall', supermarket: 'Supermarket', school: 'School',
  university: 'University', college: 'College', hospital: 'Hospital', clinic: 'Clinic', doctors: 'Doctor', pharmacy: 'Pharmacy',
  hotel: 'Hotel', guest_house: 'Guest house', restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Cafe', bar: 'Bar',
  fuel: 'Fuel station', bank: 'Bank', police: 'Police', place_of_worship: 'Place of worship', marketplace: 'Market',
  airport: 'Airport', landmark: 'Landmark', kindergarten: 'Kindergarten', stadium: 'Stadium', museum: 'Museum',
};

// How useful a kind of place usually is as a destination (searched results are ranked by this after the text match)
const KIND_WEIGHT: Record<string, number> = {
  landmark: 30, airport: 30, mall: 26, hospital: 24, university: 24, suburb: 22, stadium: 22, hotel: 20, supermarket: 18,
  school: 16, college: 16, museum: 16, bank: 14, police: 14, clinic: 14, restaurant: 12, street: 10, fuel: 10,
};

const normalise = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const labelFor = (kind: string): string => KIND_LABELS[kind] ?? kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const toEntry = (name: string, kind: string, coords: LatLng, boost = 0): Entry => {
  const norm = normalise(name);
  return { name, kind, coords, label: labelFor(kind), norm, words: norm.split(' '), weight: (KIND_WEIGHT[kind] ?? 6) + boost };
};

/** Build an index from the raw file contents. `landmarks` are hand-picked places that rank above everything else. */
export function createPlaceIndex(raw: RawPlace[], landmarks: { name: string; coords: LatLng; type?: string }[] = []): PlaceIndex {
  const entries: Entry[] = landmarks.map((l) => toEntry(l.name, l.type === 'airport' ? 'airport' : 'landmark', l.coords, 20));
  const seen = new Set(entries.map((e) => e.norm));
  for (const [name, kind, lat, lng] of raw) {
    const e = toEntry(name, kind, [lat, lng]);
    if (e.norm && !seen.has(e.norm + '|' + kind)) entries.push(e);
  }
  return { entries };
}

const km = (a: LatLng, b: LatLng): number => {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/**
 * Find places matching what the person typed. Every typed word must start a word in the name
 * ("sam nuj dr" finds "Sam Nujoma Drive"). Results are ranked by how well the name matches, then by how useful the
 * kind of place is, then by closeness to `near` (for example the pickup point).
 */
export function searchPlaces(index: PlaceIndex, query: string, opts: { near?: LatLng | null; limit?: number } = {}): Place[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const limit = opts.limit ?? 8;
  const scored: { e: Entry; score: number }[] = [];

  for (const e of index.entries) {
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (e.words.some((w) => w === t)) score += 6;
      else if (e.words.some((w) => w.startsWith(t))) score += 4;
      else if (t.length >= 3 && e.norm.includes(t)) score += 1;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (e.norm === q) score += 20;
    else if (e.norm.startsWith(q + ' ')) score += 10; // the name begins with exactly what was typed (whole words)
    score += e.weight / 4;
    if (opts.near) score -= Math.min(6, km(opts.near, e.coords) / 3); // up to 6 points lost for places 18+ km away
    scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length);
  return scored.slice(0, limit).map(({ e }) => ({ name: e.name, kind: e.kind, coords: e.coords, label: e.label }));
}

/**
 * Name a spot on the map: a named place within `placeMeters`, else the nearest street within `streetMeters`
 * ("Near Sam Nujoma Drive"), else null.
 */
export function reverseGeocode(index: PlaceIndex, point: LatLng, placeMeters = 120, streetMeters = 250): string | null {
  let bestPlace: { e: Entry; d: number } | null = null;
  let bestStreet: { e: Entry; d: number } | null = null;
  for (const e of index.entries) {
    // cheap box test first: about 0.003 degrees is 330 m
    if (Math.abs(e.coords[0] - point[0]) > 0.003 || Math.abs(e.coords[1] - point[1]) > 0.003) continue;
    const d = km(point, e.coords) * 1000;
    if (e.kind === 'street' || e.kind === 'suburb') {
      if (e.kind === 'street' && (!bestStreet || d < bestStreet.d)) bestStreet = { e, d };
    } else if (!bestPlace || d < bestPlace.d) bestPlace = { e, d };
  }
  if (bestPlace && bestPlace.d <= placeMeters) return bestPlace.e.name;
  if (bestStreet && bestStreet.d <= streetMeters) return `Near ${bestStreet.e.name}`;
  return null;
}

let indexPromise: Promise<PlaceIndex | null> | null = null;

/** Load the place index once. Resolves null if the file cannot be fetched (callers fall back to the landmark list). */
export function loadPlaceIndex(url: string, landmarks: { name: string; coords: LatLng; type?: string }[] = []): Promise<PlaceIndex | null> {
  indexPromise ??= fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data: { places: RawPlace[] }) => createPlaceIndex(data.places, landmarks))
    .catch(() => null);
  return indexPromise;
}
