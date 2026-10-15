// Server-side routing: the router on the real road graph, signed tokens, and the request handler.
//
//   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RoadRouter, haversine } from '../../supabase/functions/_shared/roadRouter.ts';
import { canonicalRoute, hmacHex, round5, signRoute } from '../../supabase/functions/_shared/routeToken.ts';
import { handleRoute, routeKm, userFromAuthHeader, TOKEN_TTL_SECONDS } from '../../supabase/functions/_shared/routeService.ts';

const graph = JSON.parse(fs.readFileSync(new URL('../../public/tiles/windhoek-roads.json', import.meta.url), 'utf8'));
const router = new RoadRouter(graph);

const CBD = [-22.5615, 17.0835];
const AIRPORT = [-22.612, 17.0795];
const MAERUA = [-22.5786, 17.0903];
const UID = '11111111-2222-3333-4444-555555555555';
const SECRET = 'a-long-random-test-secret';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const authed = (uid = UID) => ({ Authorization: `Bearer ${token({ sub: uid, role: 'authenticated' })}` });
const post = (body, headers = authed()) =>
  new Request('http://x/route', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const deps = (over = {}) => ({ secret: SECRET, router, now: () => 1_800_000_000, ...over });

describe('street distance', () => {
  test('is never shorter than the straight line and follows streets (longer than straight)', () => {
    for (const [a, b] of [[CBD, AIRPORT], [CBD, MAERUA], [MAERUA, AIRPORT]]) {
      const straight = haversine(a, b) / 1000;
      const { km, source } = routeKm(router, a, b);
      assert.equal(source, 'roads');
      assert.ok(km >= straight, `${km} < ${straight}`);
      assert.ok(km < straight * 3, `${km} is implausibly long for a ${straight} km trip`);
    }
  });

  test('is the same in both directions to within a few metres, and repeatable', () => {
    const ab = routeKm(router, CBD, AIRPORT).km;
    const ba = routeKm(router, AIRPORT, CBD).km;
    assert.ok(Math.abs(ab - ba) < 0.05);
    assert.equal(routeKm(router, CBD, AIRPORT).km, ab);
  });

  test('falls back to an estimate when there is no road graph, or the point is off the map', () => {
    const none = routeKm(null, CBD, AIRPORT);
    assert.equal(none.source, 'estimate');
    assert.ok(Math.abs(none.km - (haversine(CBD, AIRPORT) / 1000) * 1.3) < 1e-9);
    const far = routeKm(router, CBD, [-23.5, 18.0]);
    assert.equal(far.source, 'estimate');
  });
});

describe('signed tokens', () => {
  test('the signed text has the format the database builds', () => {
    assert.equal(
      canonicalRoute(UID, [-22.5615, 17.0835], [-22.612, 17.0795], 6.2, 1_800_000_600),
      `${UID}|-22.56150|17.08350|-22.61200|17.07950|6.20|1800000600`
    );
  });

  test('matches the published HMAC-SHA256 test vector (RFC 4231, case 2)', async () => {
    assert.equal(await hmacHex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  test('any change to the user, points, distance or expiry changes the signature', async () => {
    const base = await signRoute(SECRET, UID, CBD, AIRPORT, 6.2, 100);
    const variants = [
      await signRoute(SECRET, '99999999-2222-3333-4444-555555555555', CBD, AIRPORT, 6.2, 100),
      await signRoute(SECRET, UID, [CBD[0] + 0.001, CBD[1]], AIRPORT, 6.2, 100),
      await signRoute(SECRET, UID, CBD, [AIRPORT[0], AIRPORT[1] + 0.001], 6.2, 100),
      await signRoute(SECRET, UID, CBD, AIRPORT, 6.3, 100),
      await signRoute(SECRET, UID, CBD, AIRPORT, 6.2, 101),
      await signRoute('another secret entirely', UID, CBD, AIRPORT, 6.2, 100),
    ];
    for (const v of variants) assert.notEqual(v.sig, base.sig);
  });

  test('rounds coordinates to 5 decimals', () => {
    assert.equal(round5(-22.561549999), -22.56155);
    assert.equal(round5(17.0835), 17.0835);
  });
});

describe('request handler', () => {
  test('signs a route for the signed-in user', async () => {
    const res = await handleRoute(post({ pickup: CBD, dropoff: AIRPORT }), deps());
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.exp, 1_800_000_000 + TOKEN_TTL_SECONDS);
    assert.equal(out.source, 'roads');
    assert.ok(out.distance_km >= haversine(CBD, AIRPORT) / 1000);
    const again = await signRoute(SECRET, UID, out.pickup, out.dropoff, out.distance_km, out.exp);
    assert.equal(out.sig, again.sig);
  });

  test('refuses anonymous calls, other methods, and tokens that are not a signed-in user', async () => {
    assert.equal((await handleRoute(post({ pickup: CBD, dropoff: AIRPORT }, {}), deps())).status, 401);
    const anon = { Authorization: `Bearer ${token({ role: 'anon' })}` };
    assert.equal((await handleRoute(post({ pickup: CBD, dropoff: AIRPORT }, anon), deps())).status, 401);
    assert.equal((await handleRoute(new Request('http://x/route', { method: 'GET', headers: authed() }), deps())).status, 405);
  });

  test('rejects bad input', async () => {
    for (const body of [{}, { pickup: CBD }, { pickup: 'x', dropoff: AIRPORT }, { pickup: [999, 0], dropoff: AIRPORT }, { pickup: [NaN, 1], dropoff: AIRPORT }, { pickup: [1], dropoff: AIRPORT }]) {
      assert.equal((await handleRoute(post(body), deps())).status, 400, JSON.stringify(body));
    }
    assert.equal((await handleRoute(post({ pickup: CBD, dropoff: CBD }), deps())).status, 400); // same place
    const notJson = new Request('http://x/route', { method: 'POST', headers: authed(), body: 'not json' });
    assert.equal((await handleRoute(notJson, deps())).status, 400);
  });

  test('reports a missing secret or road graph instead of signing something wrong', async () => {
    assert.equal((await handleRoute(post({ pickup: CBD, dropoff: AIRPORT }), deps({ secret: undefined }))).status, 500);
    assert.equal((await handleRoute(post({ pickup: CBD, dropoff: AIRPORT }), deps({ router: null }))).status, 503);
  });

  test('reads the user id only from a well-formed authenticated token', () => {
    assert.equal(userFromAuthHeader(`Bearer ${token({ sub: UID, role: 'authenticated' })}`), UID);
    assert.equal(userFromAuthHeader(`Bearer ${token({ sub: 'not-a-uuid', role: 'authenticated' })}`), null);
    assert.equal(userFromAuthHeader('Bearer garbage'), null);
    assert.equal(userFromAuthHeader(null), null);
  });
});
