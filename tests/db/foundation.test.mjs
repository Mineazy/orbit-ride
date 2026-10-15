// Security and lifecycle tests for supabase/migrations/20261015000000_foundation.sql
//
// Runs the real migration in an in-process Postgres (PGlite) with Supabase's roles and default
// privileges emulated, then acts as different users (via SET ROLE + JWT claim) the way the app would.
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = new URL('../../supabase/migrations/20261015000000_foundation.sql', import.meta.url);
const db = new PGlite();

// Windhoek CBD -> Eros Airport: about 5.6 km in a straight line, 6.2 km by road
const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };

let phoneCounter = 0;

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      phone text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    -- Supabase grants everything on new public objects to anon/authenticated by default
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
});

// ---- helpers ---------------------------------------------------------------

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

async function asAnon(sql) {
  await db.exec('set role anon');
  try {
    return await db.query(sql);
  } finally {
    await db.exec('reset role');
  }
}

async function newUser(role = 'passenger', name = 'Test User') {
  const phone = `+26481${String(++phoneCounter).padStart(7, '0')}`;
  const { rows } = await db.query(
    'insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id',
    [phone, JSON.stringify({ role, full_name: name })]
  );
  return rows[0].id;
}

async function makeAdmin() {
  const id = await newUser('passenger', 'Admin');
  await db.query("update public.profiles set role = 'admin' where id = $1", [id]); // as postgres: auth.uid() is null
  return id;
}

async function makeApprovedDriver(tier = 'OrbitXL', { online = true } = {}) {
  const admin = await makeAdmin();
  const id = await newUser('driver', 'Driver');
  await asUser(id, 'select * from public.register_driver($1, $2, $3)', ['Tesla Model Y (White)', 'N1234W', tier]);
  await asUser(admin, "select * from public.admin_set_driver_approval($1, 'approved')", [id]);
  if (online) await asUser(id, 'select * from public.set_driver_online(true)');
  return id;
}

const requestRide = (uid, { tier = 'OrbitXL', distance = 6.2, offer = null, from = CBD, to = AIRPORT } = {}) =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    from.name, from.lat, from.lng, to.name, to.lat, to.lng, tier, distance, offer,
  ]).then(r => r.rows[0]);

const call = (uid, fn, ...args) =>
  asUser(uid, `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args).then(r => r.rows[0]);

// ---- accounts and privileges ----------------------------------------------

describe('accounts', () => {
  test('sign-up creates a profile with the requested role', async () => {
    const p = await newUser('passenger', 'Hanzu');
    const d = await newUser('driver', 'Elena');
    const { rows } = await db.query('select id, role, full_name from public.profiles where id in ($1, $2) order by role', [p, d]);
    assert.deepEqual(rows.map(r => r.role).sort(), ['driver', 'passenger']);
    assert.equal(rows.find(r => r.id === p).full_name, 'Hanzu');
  });

  test('nobody can sign up as admin', async () => {
    const id = await newUser('admin', 'Sneaky');
    const { rows } = await db.query('select role from public.profiles where id = $1', [id]);
    assert.equal(rows[0].role, 'passenger');
  });

  test('a user cannot promote themselves or change their phone', async () => {
    const id = await newUser();
    await assert.rejects(asUser(id, "update public.profiles set role = 'admin' where id = $1", [id]), /forbidden_field|permission denied/);
    await assert.rejects(asUser(id, "update public.profiles set phone = '+264000' where id = $1", [id]), /forbidden_field|permission denied/);
    const { rows } = await db.query('select role from public.profiles where id = $1', [id]);
    assert.equal(rows[0].role, 'passenger');
  });

  test('a user can edit their own name but not someone else\'s', async () => {
    const a = await newUser('passenger', 'A');
    const b = await newUser('passenger', 'B');
    await asUser(a, "update public.profiles set full_name = 'Renamed' where id = $1", [a]);
    const other = await asUser(a, "update public.profiles set full_name = 'Hacked' where id = $1 returning id", [b]);
    assert.equal(other.rows.length, 0); // RLS hides B's row, so nothing is updated
    const { rows } = await db.query('select full_name from public.profiles where id = $1', [b]);
    assert.equal(rows[0].full_name, 'B');
  });

  test('anonymous (signed-out) clients can read nothing and call nothing', async () => {
    await assert.rejects(asAnon('select * from public.rides'), /permission denied/);
    await assert.rejects(asAnon('select * from public.profiles'), /permission denied/);
    await assert.rejects(asAnon('select * from public.available_driver_counts()'), /permission denied/);
  });

  test('users only see their own profile until they share a ride', async () => {
    const p = await newUser('passenger', 'P');
    const other = await newUser('passenger', 'Other');
    const seen = await asUser(p, 'select id from public.profiles');
    assert.deepEqual(seen.rows.map(r => r.id), [p]);
    assert.ok(!seen.rows.some(r => r.id === other));
  });
});

// ---- direct writes are impossible -----------------------------------------

describe('clients cannot write ride data directly', () => {
  test('insert, update and delete on rides are denied', async () => {
    const p = await newUser();
    const ride = await requestRide(p, { tier: 'OrbitX' });
    await assert.rejects(asUser(p, `insert into public.rides (passenger_id, tier, pickup_name, dropoff_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, distance_km, suggested_fare, fare)
      values ($1, 'OrbitX', 'a', 'b', 0, 0, 1, 1, 5, 1, 1)`, [p]), /permission denied/);
    await assert.rejects(asUser(p, 'update public.rides set fare = 0.01 where id = $1', [ride.id]), /permission denied/);
    await assert.rejects(asUser(p, 'update public.rides set status = $2 where id = $1', [ride.id, 'COMPLETED']), /permission denied/);
    await assert.rejects(asUser(p, 'delete from public.rides where id = $1', [ride.id]), /permission denied/);
  });

  test('drivers, events and fares cannot be edited by normal users', async () => {
    const driver = await makeApprovedDriver('OrbitX', { online: false });
    await assert.rejects(asUser(driver, "update public.driver_profiles set approval = 'approved', rating_sum = 999 where id = $1", [driver]), /permission denied/);
    await assert.rejects(asUser(driver, "insert into public.ride_events (ride_id, event) values (gen_random_uuid(), 'x')"), /permission denied/);
    const fares = await asUser(driver, 'update public.fare_config set base_fare = 0 returning tier');
    assert.equal(fares.rows.length, 0); // RLS: only admins pass the policy
    const { rows } = await db.query("select base_fare from public.fare_config where tier = 'OrbitX'");
    assert.equal(Number(rows[0].base_fare), 2.5);
  });
});

// ---- requesting a ride -----------------------------------------------------

describe('request_ride', () => {
  test('the server computes the fare', async () => {
    const p = await newUser();
    const ride = await requestRide(p, { tier: 'OrbitXL', distance: 6.2 });
    // (5.00 + 1.25 * 6.2) * surge 1.0
    assert.equal(Number(ride.fare), 12.75);
    assert.equal(Number(ride.suggested_fare), 12.75);
    assert.equal(ride.status, 'REQUESTED');
    assert.equal(ride.passenger_id, p);
  });

  test('an offer is accepted only inside the allowed range', async () => {
    const p = await newUser();
    await assert.rejects(requestRide(p, { offer: 0.5 }), /offer_out_of_range/);
    await assert.rejects(requestRide(p, { offer: 500 }), /offer_out_of_range/);
    const ride = await requestRide(p, { offer: 14 });
    assert.equal(Number(ride.fare), 14);
    assert.equal(Number(ride.suggested_fare), 12.75);
  });

  test('rejects implausible input', async () => {
    const p = await newUser();
    await assert.rejects(requestRide(p, { from: CBD, to: CBD }), /same_location/);
    await assert.rejects(requestRide(p, { distance: 0.5 }), /invalid_distance/); // shorter than the straight line
    await assert.rejects(requestRide(p, { distance: 400 }), /invalid_distance/);
    await assert.rejects(requestRide(p, { from: { ...CBD, lat: 123 } }), /invalid_location|check constraint/);
  });

  test('only passengers can request, and only one live ride at a time', async () => {
    const p = await newUser();
    const driver = await newUser('driver');
    await assert.rejects(requestRide(driver), /not_a_passenger/);
    await requestRide(p);
    await assert.rejects(requestRide(p), /active_ride_exists/);
  });

  test('passengers cannot see other passengers\' rides', async () => {
    const a = await newUser();
    const b = await newUser();
    await requestRide(a);
    const seen = await asUser(b, 'select id from public.rides');
    assert.equal(seen.rows.length, 0);
  });
});

// ---- drivers ---------------------------------------------------------------

describe('drivers', () => {
  test('a new driver is pending and cannot go online until an admin approves', async () => {
    const id = await newUser('driver');
    const d = await call(id, 'register_driver', 'Toyota Camry', 'n99w', 'OrbitX');
    assert.equal(d.approval, 'pending');
    assert.equal(d.plate, 'N99W');
    assert.equal(d.rating, null); // no ratings yet, not a fake 5.0
    await assert.rejects(call(id, 'set_driver_online', true), /driver_not_approved/);
  });

  test('only admins approve, and passengers cannot register as drivers', async () => {
    const id = await newUser('driver');
    await call(id, 'register_driver', 'Toyota Camry', 'N99W', 'OrbitX');
    await assert.rejects(call(id, 'admin_set_driver_approval', id, 'approved'), /not_allowed/);
    const p = await newUser('passenger');
    await assert.rejects(call(p, 'register_driver', 'Toyota Camry', 'N99W', 'OrbitX'), /not_a_driver/);
    const admin = await makeAdmin();
    const d = await call(admin, 'admin_set_driver_approval', id, 'approved');
    assert.equal(d.approval, 'approved');
  });

  test('changing the vehicle sends an approved driver back for review', async () => {
    const id = await makeApprovedDriver('OrbitX');
    const d = await call(id, 'register_driver', 'New Car', 'N5W', 'OrbitXL');
    assert.equal(d.approval, 'pending');
    assert.equal(d.is_online, false);
  });

  test('availability counts reveal how many, never who', async () => {
    await makeApprovedDriver('OrbitFly');
    const p = await newUser();
    const { rows } = await asUser(p, 'select * from public.available_driver_counts()');
    assert.deepEqual(rows.map(r => r.tier), ['OrbitX', 'OrbitXL', 'OrbitFly']);
    assert.ok(rows.find(r => r.tier === 'OrbitFly').online_count >= 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['online_count', 'tier']);
  });
});

// ---- dispatch visibility and accepting -------------------------------------

describe('dispatch', () => {
  test('drivers only see open requests for their own tier while online', async () => {
    const xl = await makeApprovedDriver('OrbitXL');
    const x = await makeApprovedDriver('OrbitX');
    const offline = await makeApprovedDriver('OrbitXL', { online: false });
    const p = await newUser();
    const ride = await requestRide(p, { tier: 'OrbitXL' });

    // other tests leave open requests behind, so check the rule rather than an exact list
    const xlSees = (await asUser(xl, 'select id, tier, status from public.rides')).rows;
    assert.ok(xlSees.some(r => r.id === ride.id));
    assert.ok(xlSees.every(r => r.tier === 'OrbitXL' && r.status === 'REQUESTED'));
    assert.equal((await asUser(x, 'select id from public.rides where id = $1', [ride.id])).rows.length, 0);
    assert.equal((await asUser(offline, 'select id from public.rides')).rows.length, 0);
  });

  test('wrong tier, offline and unapproved drivers cannot accept', async () => {
    const x = await makeApprovedDriver('OrbitX');
    const offline = await makeApprovedDriver('OrbitXL', { online: false });
    const pending = await newUser('driver');
    await call(pending, 'register_driver', 'Car', 'N1W', 'OrbitXL');
    const ride = await requestRide(await newUser(), { tier: 'OrbitXL' });

    await assert.rejects(call(x, 'accept_ride', ride.id), /ride_unavailable|wrong_tier/);
    await assert.rejects(call(offline, 'accept_ride', ride.id), /driver_not_available/);
    await assert.rejects(call(pending, 'accept_ride', ride.id), /driver_not_available/);
  });

  test('when two drivers race for a ride only one wins', async () => {
    const d1 = await makeApprovedDriver('OrbitXL');
    const d2 = await makeApprovedDriver('OrbitXL');
    const ride = await requestRide(await newUser(), { tier: 'OrbitXL' });

    const first = await call(d1, 'accept_ride', ride.id);
    assert.equal(first.driver_id, d1);
    assert.equal(first.status, 'ACCEPTED');
    await assert.rejects(call(d2, 'accept_ride', ride.id), /ride_unavailable/);
    const { rows } = await db.query('select driver_id from public.rides where id = $1', [ride.id]);
    assert.equal(rows[0].driver_id, d1);
  });

  test('a driver can only hold one live ride', async () => {
    const d = await makeApprovedDriver('OrbitXL');
    const r1 = await requestRide(await newUser(), { tier: 'OrbitXL' });
    const r2 = await requestRide(await newUser(), { tier: 'OrbitXL' });
    await call(d, 'accept_ride', r1.id);
    await assert.rejects(call(d, 'accept_ride', r2.id), /driver_busy/);
  });
});

// ---- the lifecycle ---------------------------------------------------------

describe('ride lifecycle', () => {
  test('request to completion computes the platform fee and driver payout', async () => {
    const driver = await makeApprovedDriver('OrbitXL');
    const passenger = await newUser();
    const ride = await requestRide(passenger, { tier: 'OrbitXL' });

    await call(driver, 'accept_ride', ride.id);
    assert.equal((await call(driver, 'mark_arrived', ride.id)).status, 'ARRIVED');
    assert.equal((await call(driver, 'start_trip', ride.id)).status, 'IN_PROGRESS');
    const done = await call(driver, 'complete_trip', ride.id);

    assert.equal(done.status, 'COMPLETED');
    assert.equal(Number(done.platform_fee), 2.55); // 20% of 12.75
    assert.equal(Number(done.driver_payout), 10.2);
    assert.ok(done.completed_at);

    const events = await db.query('select event from public.ride_events where ride_id = $1 order by id', [ride.id]);
    assert.deepEqual(events.rows.map(e => e.event), ['requested', 'accepted', 'arrived', 'started', 'completed']);
  });

  test('steps cannot be skipped, repeated or done by the wrong driver', async () => {
    const driver = await makeApprovedDriver('OrbitXL');
    const stranger = await makeApprovedDriver('OrbitXL');
    const ride = await requestRide(await newUser(), { tier: 'OrbitXL' });
    await call(driver, 'accept_ride', ride.id);

    await assert.rejects(call(driver, 'start_trip', ride.id), /invalid_transition/); // not arrived yet
    await assert.rejects(call(driver, 'complete_trip', ride.id), /invalid_transition/);
    await assert.rejects(call(stranger, 'mark_arrived', ride.id), /not_your_ride/);
    await call(driver, 'mark_arrived', ride.id);
    await assert.rejects(call(driver, 'mark_arrived', ride.id), /invalid_transition/);
  });

  test('passengers cannot drive the trip forward themselves', async () => {
    const driver = await makeApprovedDriver('OrbitXL');
    const passenger = await newUser();
    const ride = await requestRide(passenger, { tier: 'OrbitXL' });
    await call(driver, 'accept_ride', ride.id);
    await assert.rejects(call(passenger, 'mark_arrived', ride.id), /not_your_ride/);
    await assert.rejects(call(passenger, 'complete_trip', ride.id), /not_your_ride/);
  });

  test('both sides can see each other once a driver is assigned', async () => {
    const driver = await makeApprovedDriver('OrbitXL');
    const passenger = await newUser('passenger', 'Hanzu');
    const ride = await requestRide(passenger, { tier: 'OrbitXL' });
    assert.equal((await asUser(driver, 'select id from public.profiles where id = $1', [passenger])).rows.length, 0);
    await call(driver, 'accept_ride', ride.id);
    assert.equal((await asUser(driver, 'select full_name from public.profiles where id = $1', [passenger])).rows[0].full_name, 'Hanzu');
    assert.equal((await asUser(passenger, 'select vehicle, plate from public.driver_profiles where id = $1', [driver])).rows[0].plate, 'N1234W');
  });
});

// ---- cancelling and releasing ----------------------------------------------

describe('cancel and release', () => {
  test('a passenger can cancel before the trip starts, not during it', async () => {
    const driver = await makeApprovedDriver('OrbitXL');
    const passenger = await newUser();
    const ride = await requestRide(passenger, { tier: 'OrbitXL' });
    await call(driver, 'accept_ride', ride.id);
    await call(driver, 'mark_arrived', ride.id);
    await call(driver, 'start_trip', ride.id);
    await assert.rejects(call(passenger, 'cancel_ride', ride.id, 'changed my mind'), /not_allowed/);

    const p2 = await newUser();
    const r2 = await requestRide(p2, { tier: 'OrbitXL' });
    const cancelled = await call(p2, 'cancel_ride', r2.id, 'changed my mind');
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.cancelled_by, p2);
    await assert.rejects(call(p2, 'cancel_ride', r2.id), /invalid_transition/);
  });

  test('other users cannot cancel your ride; an admin can', async () => {
    const owner = await newUser();
    const other = await newUser();
    const admin = await makeAdmin();
    const ride = await requestRide(owner);
    await assert.rejects(call(other, 'cancel_ride', ride.id), /not_allowed/);
    assert.equal((await call(admin, 'cancel_ride', ride.id, 'support')).status, 'CANCELLED');
  });

  test('a driver can hand a ride back to the pool', async () => {
    const d1 = await makeApprovedDriver('OrbitXL');
    const d2 = await makeApprovedDriver('OrbitXL');
    const ride = await requestRide(await newUser(), { tier: 'OrbitXL' });
    await call(d1, 'accept_ride', ride.id);
    const back = await call(d1, 'release_ride', ride.id);
    assert.equal(back.status, 'REQUESTED');
    assert.equal(back.driver_id, null);
    assert.equal((await call(d2, 'accept_ride', ride.id)).driver_id, d2);
  });

  test('a driver cannot go offline in the middle of a ride', async () => {
    const d = await makeApprovedDriver('OrbitXL');
    const ride = await requestRide(await newUser(), { tier: 'OrbitXL' });
    await call(d, 'accept_ride', ride.id);
    await assert.rejects(call(d, 'set_driver_online', false), /ride_in_progress/);
  });
});

// ---- ratings ---------------------------------------------------------------

describe('ratings', () => {
  async function completedRide() {
    const driver = await makeApprovedDriver('OrbitXL');
    const passenger = await newUser();
    const ride = await requestRide(passenger, { tier: 'OrbitXL' });
    await call(driver, 'accept_ride', ride.id);
    await call(driver, 'mark_arrived', ride.id);
    await call(driver, 'start_trip', ride.id);
    await call(driver, 'complete_trip', ride.id);
    return { driver, passenger, ride };
  }

  test('the passenger rates once and the driver average is computed on the server', async () => {
    const { driver, passenger, ride } = await completedRide();
    await call(passenger, 'rate_driver', ride.id, 4);
    const { rows } = await db.query('select rating, rating_count from public.driver_profiles where id = $1', [driver]);
    assert.equal(Number(rows[0].rating), 4);
    assert.equal(rows[0].rating_count, 1);
    await assert.rejects(call(passenger, 'rate_driver', ride.id, 5), /cannot_rate/); // only once
  });

  test('only the ride\'s passenger can rate, only after completion, only 1 to 5', async () => {
    const { driver, ride } = await completedRide();
    await assert.rejects(call(driver, 'rate_driver', ride.id, 5), /not_your_ride/);
    await assert.rejects(call(await newUser(), 'rate_driver', ride.id, 5), /not_your_ride/);

    const d2 = await makeApprovedDriver('OrbitXL');
    const p2 = await newUser();
    const open = await requestRide(p2, { tier: 'OrbitXL' });
    await call(d2, 'accept_ride', open.id);
    await assert.rejects(call(p2, 'rate_driver', open.id, 5), /cannot_rate/); // not completed yet

    const done = await completedRide();
    await assert.rejects(call(done.passenger, 'rate_driver', done.ride.id, 6), /invalid_rating/);
    await assert.rejects(call(done.passenger, 'rate_driver', done.ride.id, 0), /invalid_rating/);
  });
});

// ---- admin settings --------------------------------------------------------

describe('admin settings', () => {
  test('only admins can change fares, and new fares apply to new requests', async () => {
    const admin = await makeAdmin();
    const user = await newUser();
    const denied = await asUser(user, "update public.fare_config set per_km = 0 where tier = 'OrbitX' returning tier");
    assert.equal(denied.rows.length, 0);

    await asUser(admin, "update public.fare_config set per_km = 2.00, min_fare = 0 where tier = 'OrbitX'");
    const ride = await requestRide(user, { tier: 'OrbitX', distance: 6.2 });
    assert.equal(Number(ride.fare), 14.9); // 2.50 + 2.00 * 6.2
    await asUser(admin, "update public.fare_config set per_km = 0.75, min_fare = 5 where tier = 'OrbitX'");
  });
});
