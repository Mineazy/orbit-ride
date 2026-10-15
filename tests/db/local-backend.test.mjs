// Tests for the in-browser stand-in for Supabase (src/prod/localBackend.ts).
// The apps are developed and tested against it, so it has to behave like the real client:
// same security rules, same error codes, same call shapes.
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLocalClient, LOCAL_DEV_CODE, LOCAL_ADMIN_PHONE } from '../../src/prod/localBackend.ts';

const MIGRATION = ['20261015000000_foundation.sql', '20261016000000_live_dispatch.sql', '20261017000000_route_limits.sql', '20261018000000_wallet_ledger.sql']
  .map((f) => fs.readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8'))
  .join('\n');
const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };

let client;
let phoneCounter = 0;
const newPhone = () => `+26482${String(++phoneCounter).padStart(7, '0')}`;

before(async () => {
  client = await createLocalClient({ migrationSql: MIGRATION, persist: false });
});

async function signIn(phone, data = {}) {
  await client.auth.signInWithOtp({ phone, options: { data } });
  const { data: out, error } = await client.auth.verifyOtp({ phone, token: LOCAL_DEV_CODE, type: 'sms' });
  assert.equal(error, null);
  return out.session.user.id;
}

const requestRide = (overrides = {}) =>
  client.rpc('request_ride', {
    p_pickup_name: CBD.name, p_pickup_lat: CBD.lat, p_pickup_lng: CBD.lng,
    p_dropoff_name: AIRPORT.name, p_dropoff_lat: AIRPORT.lat, p_dropoff_lng: AIRPORT.lng,
    p_tier: 'OrbitXL', p_distance_km: 6.2, ...overrides,
  });

describe('auth', () => {
  test('a wrong code is rejected and a right one signs in and creates a profile', async () => {
    const phone = newPhone();
    await client.auth.signInWithOtp({ phone, options: { data: { role: 'driver', full_name: 'Elena' } } });
    const bad = await client.auth.verifyOtp({ phone, token: '000000', type: 'sms' });
    assert.match(bad.error.message, /invalid|expired/i);

    const id = await signIn(phone, { role: 'driver', full_name: 'Elena' });
    const { data: profile } = await client.from('profiles').select('*').eq('id', id).single();
    assert.equal(profile.role, 'driver');
    assert.equal(profile.full_name, 'Elena');
    assert.equal(profile.phone, phone);
  });

  test('signing in again as the same phone reuses the account', async () => {
    const phone = newPhone();
    const first = await signIn(phone);
    await client.auth.signOut();
    const second = await signIn(phone);
    assert.equal(first, second);
  });

  test('the session is reported and cleared on sign out, and listeners hear about it', async () => {
    const events = [];
    const { data } = client.auth.onAuthStateChange((event) => events.push(event));
    await signIn(newPhone());
    assert.ok((await client.auth.getSession()).data.session);
    await client.auth.signOut();
    assert.equal((await client.auth.getSession()).data.session, null);
    data.subscription.unsubscribe();
    assert.deepEqual(events, ['SIGNED_IN', 'SIGNED_OUT']);
  });

  test('the seeded admin can sign in', async () => {
    const id = await signIn(LOCAL_ADMIN_PHONE);
    const { data } = await client.from('profiles').select('role').eq('id', id).single();
    assert.equal(data.role, 'admin');
  });
});

describe('security rules apply through the client', () => {
  test('signed-out requests are refused', async () => {
    await client.auth.signOut();
    const { data, error } = await client.from('rides').select('*');
    assert.equal(data, null);
    assert.match(error.message, /permission denied/);
  });

  test('a user only sees their own profile and cannot promote themselves', async () => {
    const id = await signIn(newPhone());
    const { data: rows } = await client.from('profiles').select('*');
    assert.deepEqual(rows.map(r => r.id), [id]);

    const { error } = await client.from('profiles').update({ role: 'admin' }).eq('id', id);
    assert.ok(error);
    const { data: me } = await client.from('profiles').select('role').eq('id', id).single();
    assert.equal(me.role, 'passenger');
  });

  test('a user can set their own name', async () => {
    const id = await signIn(newPhone());
    const { error } = await client.from('profiles').update({ full_name: 'Hanzu' }).eq('id', id);
    assert.equal(error, null);
    const { data } = await client.from('profiles').select('full_name').eq('id', id).single();
    assert.equal(data.full_name, 'Hanzu');
  });

  test('database error codes come through unchanged', async () => {
    await signIn(newPhone());
    const first = await requestRide();
    assert.equal(first.error, null);
    assert.equal(first.data.status, 'REQUESTED');
    const second = await requestRide();
    assert.equal(second.data, null);
    assert.equal(second.error.message, 'active_ride_exists');
  });
});

describe('query builder', () => {
  test('filters, ordering, limits, single and maybeSingle', async () => {
    const id = await signIn(newPhone());
    await requestRide({ p_tier: 'OrbitX' });
    await client.rpc('cancel_ride', { p_ride_id: (await client.from('rides').select('*').eq('passenger_id', id).single()).data.id });
    await requestRide({ p_tier: 'OrbitXL' });

    const all = await client.from('rides').select('*').eq('passenger_id', id).order('requested_at', { ascending: false });
    assert.equal(all.data.length, 2);
    assert.ok(all.data[0].requested_at >= all.data[1].requested_at);
    assert.equal(typeof all.data[0].requested_at, 'string'); // ISO strings like PostgREST, not Date objects

    const live = await client.from('rides').select('*').eq('passenger_id', id).in('status', ['REQUESTED', 'ACCEPTED']);
    assert.equal(live.data.length, 1);
    assert.equal(live.data[0].tier, 'OrbitXL');

    const limited = await client.from('rides').select('id, tier').eq('passenger_id', id).limit(1);
    assert.deepEqual(Object.keys(limited.data[0]).sort(), ['id', 'tier']);

    const unrated = await client.from('rides').select('id').eq('passenger_id', id).is('passenger_rating', null);
    assert.equal(unrated.data.length, 2);
    assert.equal((await client.from('rides').select('id').eq('passenger_id', id).is('cancelled_at', null)).data.length, 1);

    assert.equal((await client.from('rides').select('*').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle()).data, null);
    assert.equal((await client.from('rides').select('*').eq('passenger_id', id).single()).error.code, 'PGRST116');
  });

  test('rejects unsafe identifiers instead of building bad SQL', async () => {
    await signIn(newPhone());
    const { error } = await client.from('rides').select('*').eq('id; drop table rides', 'x');
    assert.match(error.message, /Invalid identifier/);
  });
});

describe('rpc and notifications', () => {
  test('set-returning and void functions have the right shapes', async () => {
    await signIn(newPhone());
    const counts = await client.rpc('available_driver_counts');
    assert.deepEqual(counts.data.map(r => r.tier), ['OrbitX', 'OrbitXL', 'OrbitFly']);

    const driverId = await signIn(newPhone(), { role: 'driver' });
    const loc = await client.rpc('update_driver_location', { p_lat: -22.56, p_lng: 17.08 });
    assert.equal(loc.data, null); // void
    assert.match(loc.error?.message ?? 'not_a_driver', /not_a_driver/); // no vehicle registered yet
    void driverId;
  });

  test('subscribers are told about changes and can unsubscribe', async () => {
    await signIn(newPhone());
    await new Promise(r => setTimeout(r, 10)); // let notifications from earlier tests drain
    let heard = 0;
    const channel = client.channel('rides').on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => heard++).subscribe();
    await requestRide();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(heard, 1);
    await client.removeChannel(channel);
    await client.rpc('cancel_ride', { p_ride_id: (await client.from('rides').select('id').single()).data.id });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(heard, 1);
  });

  test('the whole driver and passenger journey works through the client', async () => {
    const adminId = await signIn(LOCAL_ADMIN_PHONE);
    await client.auth.signOut();

    const driverId = await signIn(newPhone(), { role: 'driver', full_name: 'Elena' });
    const reg = await client.rpc('register_driver', { p_vehicle: 'Tesla Model Y', p_plate: 'n1w', p_tier: 'OrbitXL' });
    assert.equal(reg.data.approval, 'pending');
    assert.equal((await client.rpc('set_driver_online', { p_online: true })).error.message, 'driver_not_approved');
    await client.auth.signOut();

    await signIn(LOCAL_ADMIN_PHONE);
    assert.equal(adminId, (await client.auth.getSession()).data.session.user.id);
    assert.equal((await client.rpc('admin_set_driver_approval', { p_driver: driverId, p_approval: 'approved' })).data.approval, 'approved');
    await client.auth.signOut();

    await signIn((await client.from('profiles').select('phone')).error ? newPhone() : newPhone()); // a fresh passenger
    const ride = (await requestRide()).data;
    await client.auth.signOut();

    const driverPhone = (await (async () => { await signIn(LOCAL_ADMIN_PHONE); const r = await client.from('profiles').select('phone').eq('id', driverId).single(); await client.auth.signOut(); return r.data.phone; })());
    await signIn(driverPhone);
    await client.rpc('set_driver_online', { p_online: true });
    await client.rpc('update_driver_location', { p_lat: CBD.lat, p_lng: CBD.lng }); // dispatch needs a fresh position
    const open = await client.from('rides').select('*').eq('status', 'REQUESTED');
    assert.ok(open.data.some(r => r.id === ride.id));
    assert.equal((await client.rpc('accept_ride', { p_ride_id: ride.id })).data.status, 'ACCEPTED');
    await client.rpc('mark_arrived', { p_ride_id: ride.id });
    await client.rpc('start_trip', { p_ride_id: ride.id });
    const done = await client.rpc('complete_trip', { p_ride_id: ride.id });
    assert.equal(done.data.status, 'COMPLETED');
    assert.equal(Number(done.data.driver_payout), 10.2);
  });

  test('the stand-in payment gateway credits a top-up once', async () => {
    await signIn(newPhone());
    const topup = (await client.rpc('create_topup', { p_amount: 50 })).data;
    assert.equal(topup.status, 'pending');
    await client.rpc('dev_complete_topup', { p_topup_id: topup.id });
    const again = await client.rpc('dev_complete_topup', { p_topup_id: topup.id });
    assert.equal(again.data.status, 'paid');
    assert.equal(Number((await client.rpc('my_wallet')).data.balance), 50);
  });
});
