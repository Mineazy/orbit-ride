// Tests for supabase/migrations/20261016000000_live_dispatch.sql (proximity dispatch, nearby drivers)
// and 20261017000000_route_limits.sql (route distance limits)
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (name) => fs.readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite();

const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };
const FAR = { lat: -22.5615 + 0.2, lng: 17.0835 }; // about 22 km north of the CBD
const NEAR = { lat: -22.565, lng: 17.085 }; // a few hundred metres from the CBD

let phoneCounter = 0;

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), phone text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  await db.exec(read('20261015000000_foundation.sql'));
  await db.exec(read('20261016000000_live_dispatch.sql'));
  await db.exec(read('20261017000000_route_limits.sql'));
});

async function asUser(uid, sql, params = []) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function newUser(role = 'passenger', name = 'Test User') {
  const phone = `+26481${String(++phoneCounter).padStart(7, '0')}`;
  const { rows } = await db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [
    phone, JSON.stringify({ role, full_name: name }),
  ]);
  return rows[0].id;
}

async function makeDriver(tier, at) {
  const admin = await newUser('passenger', 'Admin');
  await db.query("update public.profiles set role = 'admin' where id = $1", [admin]);
  const id = await newUser('driver', 'Driver');
  await asUser(id, 'select * from public.register_driver($1,$2,$3)', ['Toyota Corolla', 'N1234W', tier]);
  await asUser(admin, "select * from public.admin_set_driver_approval($1, 'approved')", [id]);
  await asUser(id, 'select * from public.set_driver_online(true)');
  if (at) await asUser(id, 'select public.update_driver_location($1,$2)', [at.lat, at.lng]);
  return id;
}

const requestRide = (uid, tier = 'OrbitX') =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    CBD.name, CBD.lat, CBD.lng, AIRPORT.name, AIRPORT.lat, AIRPORT.lng, tier, 6.2, null,
  ]).then(r => r.rows[0]);

const openFor = (uid) => asUser(uid, "select id from public.rides where status = 'REQUESTED'").then(r => r.rows.map(x => x.id));

// Every test cancels what it requested so passengers/drivers stay independent
async function cleanup() {
  await db.query("update public.rides set status = 'CANCELLED', cancelled_at = now() where status in ('REQUESTED','ACCEPTED','ARRIVED','IN_PROGRESS')");
}

describe('proximity dispatch', () => {
  test('a nearby driver sees the request; a far driver does not', async () => {
    const near = await makeDriver('OrbitX', NEAR);
    const far = await makeDriver('OrbitX', FAR);
    const p = await newUser();
    const ride = await requestRide(p);
    assert.ok((await openFor(near)).includes(ride.id));
    assert.ok(!(await openFor(far)).includes(ride.id));
    await cleanup();
  });

  test('a driver without a position, or with a stale one, sees nothing', async () => {
    const none = await makeDriver('OrbitX', null);
    const stale = await makeDriver('OrbitX', NEAR);
    await db.query("update public.driver_profiles set location_updated_at = now() - interval '10 minutes' where id = $1", [stale]);
    const p = await newUser();
    const ride = await requestRide(p);
    assert.ok(!(await openFor(none)).includes(ride.id));
    assert.ok(!(await openFor(stale)).includes(ride.id));
    await cleanup();
  });

  test('a far driver cannot accept even if they know the ride id', async () => {
    const far = await makeDriver('OrbitX', FAR);
    const p = await newUser();
    const ride = await requestRide(p);
    await assert.rejects(asUser(far, 'select * from public.accept_ride($1)', [ride.id]), /too_far/);
    await cleanup();
  });

  test('a nearby driver can accept', async () => {
    const near = await makeDriver('OrbitX', NEAR);
    const p = await newUser();
    const ride = await requestRide(p);
    const { rows } = await asUser(near, 'select * from public.accept_ride($1)', [ride.id]);
    assert.equal(rows[0].status, 'ACCEPTED');
    await cleanup();
  });

  test('the wider radius setting is honoured', async () => {
    const far = await makeDriver('OrbitX', FAR);
    await db.query('update public.platform_settings set dispatch_radius_km = 30');
    const p = await newUser();
    const ride = await requestRide(p);
    assert.ok((await openFor(far)).includes(ride.id));
    await db.query('update public.platform_settings set dispatch_radius_km = 8');
    await cleanup();
  });

  test('the radius must be sensible', async () => {
    await assert.rejects(db.query('update public.platform_settings set dispatch_radius_km = 0'), /check/);
    await assert.rejects(db.query('update public.platform_settings set dispatch_radius_km = 500'), /check/);
  });
});

describe('nearby drivers', () => {
  test('passengers see anonymous, rounded positions of available drivers only', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const near = await makeDriver('OrbitX', NEAR);
    await makeDriver('OrbitXL', FAR); // too far
    const busy = await makeDriver('OrbitX', NEAR);
    const p1 = await newUser();
    const ride = await requestRide(p1);
    await asUser(busy, 'select * from public.accept_ride($1)', [ride.id]);

    const p2 = await newUser();
    const { rows } = await asUser(p2, 'select * from public.nearby_drivers($1,$2)', [CBD.lat, CBD.lng]);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['lat', 'lng', 'tier']); // no ids
    assert.equal(rows[0].tier, 'OrbitX');
    assert.equal(rows[0].lat, Math.round(NEAR.lat * 1000) / 1000);
    assert.ok(near);
    await cleanup();
  });

  test('anonymous visitors cannot call it', async () => {
    await db.exec('set role anon');
    try {
      await assert.rejects(db.query('select * from public.nearby_drivers(0, 0)'), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
});

describe('live position', () => {
  test('the passenger can read their driver position during the ride, and a stranger cannot', async () => {
    const near = await makeDriver('OrbitX', NEAR);
    const p = await newUser();
    const stranger = await newUser();
    const ride = await requestRide(p);
    await asUser(near, 'select * from public.accept_ride($1)', [ride.id]);
    await asUser(near, 'select public.update_driver_location($1,$2)', [-22.563, 17.084]);

    const seen = await asUser(p, 'select lat, lng from public.driver_profiles where id = $1', [near]);
    assert.equal(seen.rows.length, 1);
    assert.equal(seen.rows[0].lat, -22.563);
    const hidden = await asUser(stranger, 'select lat from public.driver_profiles where id = $1', [near]);
    assert.equal(hidden.rows.length, 0);
    await cleanup();
  });
});

describe('route distance limits', () => {
  const ask = (uid, km) =>
    asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      CBD.name, CBD.lat, CBD.lng, AIRPORT.name, AIRPORT.lat, AIRPORT.lng, 'OrbitX', km, null,
    ]);

  test('a street distance up to the limit is accepted, beyond it is refused', async () => {
    const p = await newUser();
    // straight line is about 5.6 km; the default limit is 2.5x = 14 km
    await assert.rejects(ask(p, 15), /invalid_distance/);
    await assert.rejects(ask(p, 4), /invalid_distance/); // shorter than the straight line
    await ask(p, 13);
    await cleanup();
  });

  test('the limits can be changed by settings and must stay sensible', async () => {
    const p = await newUser();
    await db.query('update public.platform_settings set max_route_factor = 4');
    await ask(p, 20);
    await cleanup();
    await db.query('update public.platform_settings set max_route_factor = 2.5');
    await assert.rejects(db.query('update public.platform_settings set max_route_factor = 1'), /check/);
    await assert.rejects(db.query('update public.platform_settings set max_route_extra_km = -1'), /check/);
  });

  test('short trips still get a few kilometres of slack', async () => {
    const p = await newUser();
    // ~0.4 km straight: 2.5x would be 1 km, but the extra allowance lets a winding 2.2 km route through
    const { rows } = await asUser(p, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      CBD.name, CBD.lat, CBD.lng, 'Nearby', -22.565, 17.085, 'OrbitX', 2.2, null,
    ]);
    assert.equal(rows[0].status, 'REQUESTED');
    await cleanup();
  });
});
