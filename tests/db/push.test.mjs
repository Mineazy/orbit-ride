// Tests for supabase/migrations/20261021000000_push_notifications.sql (devices, outbox, who gets told what)
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const db = new PGlite();

const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };
const FAR = { lat: CBD.lat + 0.2, lng: CBD.lng };

let phoneCounter = 0;

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), phone text, raw_user_meta_data jsonb not null default '{}'::jsonb, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    -- a stand-in for the pg_net extension, which records the calls it would make
    create schema net;
    create table net.calls (id serial primary key, url text, body jsonb, headers jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
      returns bigint language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id::bigint $$;
  `);
  for (const m of migrations) await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), 'utf8'));
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
const call = (uid, fn, ...args) =>
  asUser(uid, `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args).then(r => r.rows[0]);

async function newUser(role = 'passenger', name = 'Test User') {
  const phone = `+26481${String(++phoneCounter).padStart(7, '0')}`;
  const { rows } = await db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [phone, JSON.stringify({ role, full_name: name })]);
  return rows[0].id;
}

let adminId;
async function admin() {
  adminId ??= await newUser('passenger', 'Admin');
  await db.query("update public.profiles set role = 'admin' where id = $1", [adminId]);
  return adminId;
}

async function makeDriver({ tier = 'OrbitX', at = { lat: CBD.lat + 0.002, lng: CBD.lng }, name = 'Elena Driver' } = {}) {
  const a = await admin();
  const id = await newUser('driver', name);
  await asUser(id, 'select * from public.register_driver($1,$2,$3)', ['Toyota Corolla', 'N1234W', tier]);
  await asUser(a, "select * from public.admin_set_driver_approval($1, 'approved')", [id]);
  await asUser(id, 'select * from public.set_driver_online(true)');
  if (at) await asUser(id, 'select public.update_driver_location($1,$2)', [at.lat, at.lng]);
  return id;
}

const request = (uid, tier = 'OrbitX') =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8)', [CBD.name, CBD.lat, CBD.lng, AIRPORT.name, AIRPORT.lat, AIRPORT.lng, tier, 6.2]).then(r => r.rows[0]);

const outbox = (uid) => db.query('select * from public.push_outbox where user_id = $1 order by id', [uid]).then(r => r.rows);
const titles = async (uid) => (await outbox(uid)).map(r => r.title);
const clearOutbox = () => db.query('delete from public.push_outbox');

const FCM_TOKEN = 'fcm-token-abcdefghijklmnopqrstuvwxyz';
const web = (n) => ({ endpoint: `https://push.example/send/${n}-aaaaaaaaaa`, keys: { p256dh: 'BPubKey', auth: 'authSecret' } });

describe('registering devices', () => {
  test('an app can register and unregister its own device', async () => {
    const p = await newUser();
    await call(p, 'register_device', 'android', FCM_TOKEN);
    const mine = await asUser(p, 'select platform, token from public.device_tokens');
    assert.deepEqual(mine.rows, [{ platform: 'android', token: FCM_TOKEN }]);
    await call(p, 'unregister_device', FCM_TOKEN);
    assert.equal((await asUser(p, 'select * from public.device_tokens')).rows.length, 0);
  });

  test('a browser registers with its subscription; incomplete ones are refused', async () => {
    const p = await newUser();
    const sub = web(1);
    await call(p, 'register_device', 'web', sub.endpoint, sub);
    assert.deepEqual((await db.query('select subscription from public.device_tokens where token = $1', [sub.endpoint])).rows[0].subscription, sub);
    await assert.rejects(call(p, 'register_device', 'web', web(2).endpoint), /invalid_device/);
    await assert.rejects(call(p, 'register_device', 'web', web(3).endpoint, { endpoint: 'x', keys: { p256dh: 'a' } }), /invalid_device/);
  });

  test('bad platforms and tokens are refused; signed-out visitors cannot register', async () => {
    const p = await newUser();
    await assert.rejects(call(p, 'register_device', 'blackberry', FCM_TOKEN), /invalid_device/);
    await assert.rejects(call(p, 'register_device', 'ios', 'short'), /invalid_device/);
    await assert.rejects(asRole('anon', null, "select public.register_device('ios', $1)", [FCM_TOKEN]), /permission denied/);
  });

  test('a phone that signs in as someone else moves to the new person', async () => {
    const a = await newUser();
    const b = await newUser();
    await call(a, 'register_device', 'ios', 'shared-phone-token-0001');
    await call(b, 'register_device', 'ios', 'shared-phone-token-0001');
    assert.equal((await asUser(a, 'select * from public.device_tokens')).rows.length, 0);
    assert.equal((await asUser(b, 'select * from public.device_tokens')).rows.length, 1);
  });

  test('people cannot see or remove each others devices', async () => {
    const a = await newUser();
    const b = await newUser();
    await call(a, 'register_device', 'android', 'tokens-of-person-a-0001');
    assert.equal((await asUser(b, 'select * from public.device_tokens')).rows.length, 0);
    await call(b, 'unregister_device', 'tokens-of-person-a-0001');
    assert.equal((await asUser(a, 'select * from public.device_tokens')).rows.length, 1);
    await assert.rejects(asUser(b, "insert into public.device_tokens (user_id, platform, token) values ($1, 'ios', 'forged-token-0000000')", [a]), /row-level security|permission denied/);
  });

  test('at most 10 devices per person are kept', async () => {
    const p = await newUser();
    for (let i = 0; i < 12; i++) await call(p, 'register_device', 'android', `device-number-${String(i).padStart(2, '0')}-xxxxxx`);
    assert.equal((await asUser(p, 'select * from public.device_tokens')).rows.length, 10);
  });
});

describe('the outbox is private', () => {
  test('nobody can read or write it through the API', async () => {
    const p = await newUser();
    await assert.rejects(asUser(p, 'select * from public.push_outbox'), /permission denied/);
    await assert.rejects(asUser(p, "insert into public.push_outbox (user_id, title, body) values ($1, 'x', 'y')", [p]), /permission denied/);
    await assert.rejects(asUser(p, "select public.queue_push($1, 'x', 'y')", [p]), /permission denied/);
    await assert.rejects(asRole('anon', null, 'select * from public.push_outbox'), /permission denied/);
  });
});

describe('who is told about a new request', () => {
  test('only nearby, available drivers of the right vehicle type with a fresh position', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const near = await makeDriver();
    const far = await makeDriver({ at: FAR });
    const wrongTier = await makeDriver({ tier: 'OrbitXL' });
    const noPosition = await makeDriver({ at: null });
    const stale = await makeDriver();
    await db.query("update public.driver_profiles set location_updated_at = now() - interval '10 minutes' where id = $1", [stale]);
    const offline = await makeDriver();
    await asUser(offline, 'select * from public.set_driver_online(false)');
    await clearOutbox();

    const p = await newUser();
    const ride = await request(p);
    assert.deepEqual(await titles(near), ['New ride request']);
    assert.equal((await outbox(near))[0].data.ride_id, ride.id);
    for (const id of [far, wrongTier, noPosition, stale, offline, p]) assert.deepEqual(await titles(id), []);
    await call(p, 'cancel_ride', ride.id);
  });

  test('a driver already on a ride is not disturbed', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const busy = await makeDriver();
    const p1 = await newUser();
    const r1 = await request(p1);
    await call(busy, 'accept_ride', r1.id);
    await clearOutbox();
    const p2 = await newUser();
    const r2 = await request(p2);
    assert.deepEqual(await titles(busy), []);
    await call(p2, 'cancel_ride', r2.id);
    await call(p1, 'cancel_ride', r1.id);
  });

  test('only the 10 nearest drivers are told', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const drivers = [];
    for (let i = 0; i < 12; i++) drivers.push(await makeDriver({ at: { lat: CBD.lat + 0.001 * (i + 1), lng: CBD.lng } }));
    await clearOutbox();
    const p = await newUser();
    const ride = await request(p);
    const told = (await db.query("select count(distinct user_id)::int as n from public.push_outbox where title = 'New ride request'")).rows[0].n;
    assert.equal(told, 10);
    assert.deepEqual(await titles(drivers[11]), []); // the farthest two are left out
    await call(p, 'cancel_ride', ride.id);
  });
});

describe('ride progress', () => {
  test('the passenger hears accepted (with who is coming), arrived and completed', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const d = await makeDriver({ name: 'Elena Driver' });
    const p = await newUser();
    const ride = await request(p);
    await clearOutbox();

    await call(d, 'accept_ride', ride.id);
    const accepted = (await outbox(p))[0];
    assert.equal(accepted.title, 'Driver on the way');
    assert.match(accepted.body, /Elena Driver · Toyota Corolla N1234W/);
    assert.equal(accepted.data.type, 'ride_accepted');

    await call(d, 'mark_arrived', ride.id);
    await call(d, 'start_trip', ride.id);
    await call(d, 'complete_trip', ride.id);
    assert.deepEqual(await titles(p), ['Driver on the way', 'Your driver has arrived', 'You have arrived']);
    assert.match((await outbox(p))[2].body, /Fare N\$\d+\.\d\d/);
    assert.deepEqual(await titles(d), []); // the driver is not told about their own actions
  });

  test('a driver handing the ride back tells the passenger and offers it to other drivers', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const first = await makeDriver();
    const second = await makeDriver();
    const p = await newUser();
    const ride = await request(p);
    await call(first, 'accept_ride', ride.id);
    await clearOutbox();
    await call(first, 'release_ride', ride.id);
    assert.deepEqual(await titles(p), ['Looking for another driver']);
    assert.deepEqual(await titles(second), ['New ride request']);
    assert.deepEqual(await titles(first), []); // the driver who gave it up is not asked to take it again
    await call(p, 'cancel_ride', ride.id);
  });

  test('cancelling: the other side is told, the canceller is not', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const d = await makeDriver();
    const p = await newUser();
    const ride = await request(p);
    await call(d, 'accept_ride', ride.id);
    await clearOutbox();
    await call(p, 'cancel_ride', ride.id, 'changed my mind');
    assert.deepEqual(await titles(d), ['Ride cancelled']);
    assert.deepEqual(await titles(p), []);
  });

  test('an admin cancelling tells both people', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const a = await admin();
    const d = await makeDriver();
    const p = await newUser();
    const ride = await request(p);
    await call(d, 'accept_ride', ride.id);
    await clearOutbox();
    await call(a, 'cancel_ride', ride.id, 'stuck');
    assert.deepEqual(await titles(d), ['Ride cancelled']);
    assert.deepEqual(await titles(p), ['Ride cancelled']);
  });

  test('a passenger cancelling before anyone accepted tells nobody', async () => {
    await db.query("update public.driver_profiles set is_online = false");
    const d = await makeDriver();
    const p = await newUser();
    const ride = await request(p);
    await clearOutbox();
    await call(p, 'cancel_ride', ride.id);
    assert.deepEqual(await titles(d), []);
    assert.deepEqual(await titles(p), []);
  });
});

describe('driver account and money', () => {
  test('approval changes are announced to the driver', async () => {
    const a = await admin();
    const id = await newUser('driver', 'New Driver');
    await call(id, 'register_driver', 'Toyota Corolla', 'N1234W', 'OrbitX');
    await clearOutbox();
    await call(a, 'admin_set_driver_approval', id, 'approved');
    await call(a, 'admin_set_driver_approval', id, 'suspended');
    assert.deepEqual(await titles(id), ['You are approved', 'Account suspended']);
    const other = await newUser('driver', 'Other');
    await call(other, 'register_driver', 'Toyota Corolla', 'N5555W', 'OrbitX');
    await clearOutbox();
    await call(a, 'admin_set_driver_approval', other, 'rejected');
    assert.deepEqual(await titles(other), ['Application not approved']);
  });

  test('payouts: paid and rejected are announced', async () => {
    const a = await admin();
    await db.query("update public.platform_settings set wallet_enabled = true");
    const d = await makeDriver();
    const acct = (await db.query('select public.ledger_account($1) as id', [d])).rows[0].id;
    await db.query("update public.ledger_accounts set balance = 100 where id = $1", [acct]);
    await db.query("insert into public.ledger_entries (transfer_id, account_id, amount, balance_after, kind) values (gen_random_uuid(), $1, 100, 100, 'adjustment')", [acct]);
    await clearOutbox();
    const w1 = await call(d, 'request_withdrawal', 40);
    const w2 = await call(d, 'request_withdrawal', 30);
    await call(a, 'admin_resolve_withdrawal', w1.id, 'paid');
    await call(a, 'admin_resolve_withdrawal', w2.id, 'rejected');
    assert.deepEqual(await titles(d), ['Payout sent', 'Payout not paid']);
    assert.match((await outbox(d))[0].body, /N\$40\.00/);
  });
});

describe('delivery hook', () => {
  const calls = () => db.query('select * from net.calls order by id').then(r => r.rows);

  test('nothing is called until the webhook secrets are stored', async () => {
    await db.query('delete from net.calls');
    await db.query("delete from public.server_secrets where name like 'push_webhook%'");
    const p = await newUser();
    await db.query("select public.queue_push($1, 'hello', 'world')", [p]);
    assert.equal((await calls()).length, 0);
  });

  test('a queued message wakes the sender with its id and the shared secret', async () => {
    await db.query("insert into public.server_secrets (name, value) values ('push_webhook_url', 'https://proj.supabase.co/functions/v1/send-push'), ('push_webhook_secret', 'shh-its-a-secret-value')");
    const p = await newUser();
    await db.query("select public.queue_push($1, 'hello', 'world')", [p]);
    const c = await calls();
    assert.equal(c.length, 1);
    assert.equal(c[0].url, 'https://proj.supabase.co/functions/v1/send-push');
    assert.equal(c[0].headers['x-push-secret'], 'shh-its-a-secret-value');
    const row = (await outbox(p))[0];
    assert.deepEqual(c[0].body, { id: Number(row.id) });
    assert.ok(!JSON.stringify(c[0].body).includes('hello')); // the message itself never leaves the database this way
  });

  test('a failing hook never blocks the ride that caused it', async () => {
    await db.query('create or replace function net.http_post(url text, body jsonb default $$ {} $$, params jsonb default $$ {} $$, headers jsonb default $$ {} $$, timeout_milliseconds int default 1000) returns bigint language plpgsql as $$ begin raise exception \'network down\'; end $$');
    await db.query("update public.driver_profiles set is_online = false");
    await makeDriver();
    const p = await newUser();
    const ride = await request(p); // would raise if the hook error escaped
    assert.equal(ride.status, 'REQUESTED');
    await call(p, 'cancel_ride', ride.id);
  });
});
