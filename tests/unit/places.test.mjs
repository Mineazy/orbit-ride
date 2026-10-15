// Place search and reverse geocoding over the real index built from the map tiles.
//
//   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlaceIndex, searchPlaces, reverseGeocode } from '../../src/utils/placeSearch.ts';

const raw = JSON.parse(fs.readFileSync(new URL('../../public/tiles/windhoek-places.json', import.meta.url), 'utf8'));
const landmarks = [
  { name: 'Maerua Mall', coords: [-22.5786, 17.0903], type: 'shopping' },
  { name: 'Eros Airport (ERS)', coords: [-22.612, 17.0795], type: 'airport' },
];
const index = createPlaceIndex(raw.places, landmarks);

describe('place index file', () => {
  test('is big enough to be useful and every entry is well formed', () => {
    assert.ok(raw.places.length > 2000, `only ${raw.places.length} places`);
    for (const [name, kind, lat, lng] of raw.places) {
      assert.ok(name && kind);
      assert.ok(lat > -22.7 && lat < -22.4 && lng > 16.9 && lng < 17.2, `${name} is outside Windhoek`);
    }
  });
});

describe('search', () => {
  test('finds a street by partial words', () => {
    const r = searchPlaces(index, 'sam nuj');
    assert.ok(r.length > 0);
    assert.match(r[0].name, /Sam Nujoma/);
  });

  test('landmarks rank first', () => {
    assert.equal(searchPlaces(index, 'maerua')[0].name, 'Maerua Mall');
    assert.match(searchPlaces(index, 'airport')[0].name, /Eros Airport/);
  });

  test('ignores case, accents and punctuation', () => {
    assert.equal(searchPlaces(index, 'MAERUA!!')[0].name, 'Maerua Mall');
  });

  test('whole-word matches beat longer words that merely start the same way', () => {
    const names = searchPlaces(index, 'hospital', { limit: 5 }).map((r) => r.name);
    assert.ok(names.length >= 3);
    assert.ok(names.slice(0, 3).every((n) => /hospital/i.test(n) && !/hospitality/i.test(n)), names.join(', '));
  });

  test('every word must match', () => {
    assert.equal(searchPlaces(index, 'maerua zzzqqq').length, 0);
  });

  test('too-short queries return nothing', () => {
    assert.deepEqual(searchPlaces(index, 'a'), []);
    assert.deepEqual(searchPlaces(index, '   '), []);
  });

  test('closer results win when names tie', () => {
    const nearNorth = searchPlaces(index, 'church', { near: [-22.5, 17.05], limit: 1 })[0];
    const nearSouth = searchPlaces(index, 'church', { near: [-22.65, 17.1], limit: 1 })[0];
    assert.ok(nearNorth && nearSouth);
    assert.notEqual(nearNorth.name + nearNorth.coords, nearSouth.name + nearSouth.coords);
  });

  test('respects the limit and labels results', () => {
    const r = searchPlaces(index, 'street', { limit: 3 });
    assert.ok(r.length <= 3);
    for (const p of r) assert.ok(p.label);
  });
});

describe('reverse geocoding', () => {
  test('names a landmark when standing on it', () => {
    assert.equal(reverseGeocode(index, [-22.5786, 17.0903]), 'Maerua Mall');
  });

  test('names the nearest street otherwise', () => {
    const street = raw.places.find((p) => p[1] === 'street');
    const name = reverseGeocode(index, [street[2] + 0.0005, street[3]]);
    assert.ok(name, 'expected a name near a known street');
  });

  test('returns null in the middle of nowhere', () => {
    assert.equal(reverseGeocode(index, [-22.9, 16.5]), null);
  });
});
