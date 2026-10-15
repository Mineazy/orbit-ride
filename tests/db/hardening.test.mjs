// Tests for supabase/migrations/20261019000000_hardening.sql (account deletion, rate limits, error log)
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = [
  '20261015000000_foundation.sql',
  '20261016000000_live_dispatch.sql',
  '20261017000000_route_limits.sql',
  '20261018000000_wallet_ledger.sql',
  '20261019000000_hardening.sql',
];
const db = new PGlite();

const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };

let phoneCounter = 0;

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(), phone text, raw_user_meta_data jsonb not null default '{}'::jsonb,
      banned_until timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  for (const m of MIGRATIONS) await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), 'utf8'));
});

async function asRole(role, uid, sql, params = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? '']);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const asUser = (uid, sql, params) => asRole('authenticated', uid, sql, params);

async function newUser(role = 'passenger', name = 'Test User') {
  const phone = `+26481${String(++phoneCounter).padStart(7, '0')}`;
  const { rows } = await db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [
    phone, JSON.stringify({ role, full_name: name }),
  ]);
  return { id: rows[0].id, phone };
}

let adminId;
async function admin() {
  if (!adminId) {
    adminId = (await newUser('passenger', 'Admin')).id;
    await db.query("update public.profiles set role = 'admin' where id = $1", [adminId]);
  }
  return adminId;
}

async function makeDriver() {
  const a = await admin();
  const { id } = await newUser('driver', 'Driver');
  await asUser(id, 'select * from public.register_driver($1,$2,$3)', ['Toyota Corolla', 'N1234W', 'OrbitX']);
  await asUser(a, "select * from public.admin_set_driver_approval($1, 'approved')", [id]);
  await asUser(id, 'select * from public.set_driver_online(true)');
  await asUser(id, 'select public.update_driver_location($1,$2)', [CBD.lat + 0.002, CBD.lng]);
  return id;
}

const request = (uid) =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8)', [
    CBD.name, CBD.lat, CBD.lng, AIRPORT.name, AIRPORT.lat, AIRPORT.lng, 'OrbitX', 6.2,
  ]).then(r => r.rows[0]);

const call = (uid, fn, ...args) =>
  asUser(uid, `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args).then(r => r.rows[0]);

async function finishRide(passenger, driver) {
  const ride = await request(passenger);
  await call(driver, 'accept_ride', ride.id);
  await call(driver, 'mark_arrived', ride.id);
  await call(driver, 'start_trip', ride.id);
  return call(driver, 'complete_trip', ride.id);
}

describe('account deletion', () => {
  test('a passenger with nothing outstanding can delete; personal details are erased, rides stay', async () => {
    const p = await newUser('passenger', 'Hanzu Shikongo');
    const d = await makeDriver();
    const ride = await finishRide(p.id, d);

    await call(p.id, 'delete_my_account');
    const prof = (await db.query('select * from public.profiles where id = $1', [p.id])).rows[0];
    assert.equal(prof.full_name, 'Deleted user');
    assert.equal(prof.phone, null);
    assert.ok(prof.deleted_at);
    const auth = (await db.query('select * from auth.users where id = $1', [p.id])).rows[0];
    assert.equal(auth.phone, null);
    assert.ok(auth.banned_until); // the old identity cannot sign in again
    assert.deepEqual(auth.raw_user_meta_data, {});
    // the ride record (and the driver's earnings) are kept
    assert.equal((await db.query('select count(*)::int as n from public.rides where id = $1', [ride.id])).rows[0].n, 1);
  });

  test('the same phone number can sign up again afterwards as a new person', async () => {
    const p = await newUser('passenger', 'Reuse');
    await call(p.id, 'delete_my_account');
    const again = await db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [
      p.phone, JSON.stringify({ role: 'passenger', full_name: 'New Me' }),
    ]);
    assert.ok(again.rows[0].id);
    assert.equal((await db.query('select full_name from public.profiles where id = $1', [again.rows[0].id])).rows[0].full_name, 'New Me');
  });

  test('cannot delete during a ride', async () => {
    const p = await newUser();
    const d = await makeDriver();
    const ride = await request(p.id);
    await assert.rejects(call(p.id, 'delete_my_account'), /active_ride_exists/);
    await call(d, 'accept_ride', ride.id);
    await assert.rejects(call(d, 'delete_my_account'), /active_ride_exists/);
    await call(p.id, 'cancel_ride', ride.id);
  });

  test('cannot delete while money is owed, held or waiting to be paid out', async () => {
    const p = await newUser();
    const d = await makeDriver();
    await finishRide(p.id, d); // cash ride: the driver now owes the platform fee
    await assert.rejects(call(d, 'delete_my_account'), /balance_not_settled/);
    const a = await admin();
    const owed = Number((await call(d, 'my_wallet')).balance);
    await call(a, 'admin_record_payment', d, -owed, 'fees settled in cash');
    await call(d, 'delete_my_account'); // settled: now it works
    assert.equal((await db.query('select approval from public.driver_profiles where id = $1', [d])).rows[0].approval, 'suspended');
    assert.equal((await db.query('select is_online from public.driver_profiles where id = $1', [d])).rows[0].is_online, false);
  });

  test('admins and signed-out visitors cannot use it', async () => {
    const a = await admin();
    await assert.rejects(call(a, 'delete_my_account'), /not_allowed/);
    await assert.rejects(asRole('anon', null, 'select public.delete_my_account()'), /permission denied/);
  });
});

describe('rate limits', () => {
  test('a passenger cannot request more than 10 rides an hour', async () => {
    const p = await newUser();
    for (let i = 0; i < 10; i++) {
      const ride = await request(p.id);
      await call(p.id, 'cancel_ride', ride.id);
    }
    await assert.rejects(request(p.id), /too_many_requests/);
    // other people are not affected
    const other = await newUser();
    const ride = await request(other.id);
    await call(other.id, 'cancel_ride', ride.id);
  });

  test('top-ups are limited too', async () => {
    await db.query('update public.platform_settings set wallet_enabled = true');
    const p = await newUser();
    for (let i = 0; i < 10; i++) await call(p.id, 'create_topup', 20);
    await assert.rejects(call(p.id, 'create_topup', 20), /too_many_requests/);
    await db.query('update public.platform_settings set wallet_enabled = false');
  });
});

describe('error log', () => {
  const report = (uid, msg, app = 'passenger') =>
    uid ? asUser(uid, 'select public.report_client_error($1,$2,$3,$4)', [app, msg, 'stack', 'https://app/x'])
        : asRole('anon', null, 'select public.report_client_error($1,$2,$3,$4)', [app, msg, null, null]);

  test('signed-in and signed-out visitors can report; only admins can read', async () => {
    const a = await admin();
    const p = await newUser();
    await report(p.id, 'TypeError: x is undefined');
    await report(null, 'sign-in crashed', 'driver');
    const seen = await asUser(a, 'select message, app, user_id from public.client_errors order by id');
    assert.ok(seen.rows.some(r => r.message === 'TypeError: x is undefined' && r.user_id === p.id));
    assert.ok(seen.rows.some(r => r.message === 'sign-in crashed' && r.user_id === null && r.app === 'driver'));
    assert.equal((await asUser(p.id, 'select * from public.client_errors')).rows.length, 0);
  });

  test('empty reports are ignored, long ones are cut, unknown apps are labelled unknown', async () => {
    const p = await newUser();
    await report(p.id, '   ');
    await asUser(p.id, 'select public.report_client_error($1,$2,$3,$4)', ['evil', 'x'.repeat(5000), 'y'.repeat(9000), 'z'.repeat(1000)]);
    const row = (await db.query("select * from public.client_errors where user_id = $1", [p.id])).rows[0];
    assert.equal(row.app, 'unknown');
    assert.equal(row.message.length, 500);
    assert.equal(row.stack.length, 2000);
    assert.equal(row.url.length, 300);
  });

  test('each user is limited to 20 an hour; extras are dropped without an error', async () => {
    const p = await newUser();
    for (let i = 0; i < 25; i++) await report(p.id, `boom ${i}`);
    assert.equal((await db.query('select count(*)::int as n from public.client_errors where user_id = $1', [p.id])).rows[0].n, 20);
  });

  test('entries older than 30 days are removed as new ones arrive', async () => {
    const p = await newUser();
    await db.query("insert into public.client_errors (app, message, created_at) values ('admin', 'ancient', now() - interval '40 days')");
    await report(p.id, 'fresh');
    assert.equal((await db.query("select count(*)::int as n from public.client_errors where message = 'ancient'")).rows[0].n, 0);
  });
});
