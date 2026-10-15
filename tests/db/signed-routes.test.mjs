// Tests for supabase/migrations/20261020000000_signed_routes.sql: the database accepts only server-signed distances.
// Signatures here are made by the same TypeScript code the edge function uses, so this also proves the two agree.
//
//   npm run test:db

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { signRoute } from '../../supabase/functions/_shared/routeToken.ts';

const migrations = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const db = new PGlite();
const SECRET = 'a-long-random-test-secret';

const CBD = { name: 'Windhoek CBD', lat: -22.5615, lng: 17.0835 };
const AIRPORT = { name: 'Eros Airport', lat: -22.612, lng: 17.0795 };

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

async function newPassenger() {
  const phone = `+26481${String(++phoneCounter).padStart(7, '0')}`;
  const { rows } = await db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [phone, JSON.stringify({ role: 'passenger', full_name: 'P' })]);
  return rows[0].id;
}

const now = () => Math.floor(Date.now() / 1000);

// ask for a ride with explicit signature fields
const request = (uid, { km = 6.2, exp = null, sig = null, from = CBD, to = AIRPORT } = {}) =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
    from.name, from.lat, from.lng, to.name, to.lat, to.lng, 'OrbitX', km, null, 'cash', exp, sig,
  ]).then(r => r.rows[0]);

const signed = async (uid, { km = 6.2, exp = now() + 600, from = CBD, to = AIRPORT, secret = SECRET } = {}) =>
  signRoute(secret, uid, [from.lat, from.lng], [to.lat, to.lng], km, exp);

async function cancelAll() {
  await db.query("update public.rides set status = 'CANCELLED', cancelled_at = now() where status = 'REQUESTED'");
}

describe('HMAC-SHA256 in SQL', () => {
  const hmac = async (key, msg) =>
    (await db.query("select encode(public.hmac_sha256(convert_to($1,'UTF8'), convert_to($2,'UTF8')), 'hex') as h", [key, msg])).rows[0].h;

  test('matches the published test vectors (RFC 4231)', async () => {
    assert.equal(await hmac('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    // a key longer than one block is hashed first
    const { rows } = await db.query(
      "select encode(public.hmac_sha256(decode(repeat('aa', 131), 'hex'), convert_to('Test Using Larger Than Block-Size Key - Hash Key First', 'UTF8')), 'hex') as h"
    );
    assert.equal(rows[0].h, '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });
});

describe('while signed routes are not required (the default)', () => {
  test('the old plausibility check still applies and unsigned requests work', async () => {
    const p = await newPassenger();
    await request(p);
    await cancelAll();
    await assert.rejects(request(p, { km: 400 }), /invalid_distance/);
  });
});

describe('when signed routes are required', () => {
  before(async () => {
    await db.query("insert into public.server_secrets (name, value) values ('route_signing', $1)", [SECRET]);
    await db.query('update public.platform_settings set require_signed_routes = true');
  });

  test('an unsigned request is refused', async () => {
    const p = await newPassenger();
    await assert.rejects(request(p), /route_not_verified/);
    await assert.rejects(request(p, { exp: now() + 600 }), /route_not_verified/);
    await assert.rejects(request(p, { sig: 'abc' }), /route_not_verified/);
  });

  test('a signature made by the edge function code is accepted', async () => {
    const p = await newPassenger();
    const s = await signed(p);
    const ride = await request(p, { km: s.distance_km, exp: s.exp, sig: s.sig });
    assert.equal(ride.status, 'REQUESTED');
    assert.equal(Number(ride.distance_km), 6.2);
    await cancelAll();
  });

  test('a longer distance that the server really measured is accepted even beyond the plausibility limit', async () => {
    const p = await newPassenger();
    const s = await signed(p, { km: 30 }); // 30 km is above 2.5x the 5.6 km straight line
    const ride = await request(p, { km: 30, exp: s.exp, sig: s.sig });
    assert.equal(Number(ride.distance_km), 30);
    await cancelAll();
  });

  test('an inflated distance with a signature for a different distance is refused', async () => {
    const p = await newPassenger();
    const s = await signed(p, { km: 6.2 });
    await assert.rejects(request(p, { km: 9.9, exp: s.exp, sig: s.sig }), /route_not_verified/);
  });

  test('a signature cannot be moved to other points, another user, or a later expiry', async () => {
    const p = await newPassenger();
    const other = await newPassenger();
    const s = await signed(p);
    await assert.rejects(request(other, { km: s.distance_km, exp: s.exp, sig: s.sig }), /route_not_verified/);
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: s.sig, to: { ...AIRPORT, lat: AIRPORT.lat + 0.01 } }), /route_not_verified/);
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp + 3600, sig: s.sig }), /route_not_verified/);
  });

  test('an expired signature is refused', async () => {
    const p = await newPassenger();
    const s = await signed(p, { exp: now() - 5 });
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: s.sig }), /route_not_verified/);
  });

  test('a signature made with the wrong secret is refused', async () => {
    const p = await newPassenger();
    const s = await signed(p, { secret: 'someone elses guess at the secret' });
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: s.sig }), /route_not_verified/);
  });

  test('the signature is case-insensitive hex but nothing else', async () => {
    const p = await newPassenger();
    const s = await signed(p);
    const ride = await request(p, { km: s.distance_km, exp: s.exp, sig: s.sig.toUpperCase() });
    assert.ok(ride.id);
    await cancelAll();
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: `${s.sig} ` }), /route_not_verified/);
  });

  test('a distance shorter than the straight line is still refused even when signed', async () => {
    const p = await newPassenger();
    const s = await signed(p, { km: 1 });
    await assert.rejects(request(p, { km: 1, exp: s.exp, sig: s.sig }), /invalid_distance/);
  });

  test('without the stored secret nothing verifies, and nobody can read or write the secrets table', async () => {
    const p = await newPassenger();
    await assert.rejects(asUser(p, 'select * from public.server_secrets'), /permission denied/);
    await assert.rejects(asUser(p, "insert into public.server_secrets (name, value) values ('route_signing', 'mine-mine-mine-mine')"), /permission denied/);
    await assert.rejects(asRole('anon', null, 'select * from public.server_secrets'), /permission denied/);
    await assert.rejects(asUser(p, "select public.verify_route(gen_random_uuid(), 0, 0, 0, 0, 1, 1, 'x')"), /permission denied/);
    await assert.rejects(asUser(p, "select public.hmac_sha256('a'::bytea, 'b'::bytea)"), /permission denied/);

    await db.query("update public.server_secrets set value = 'short'");
    const s = await signed(p, { secret: 'short' });
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: s.sig }), /route_not_verified/); // too weak to trust
    await db.query('delete from public.server_secrets');
    await assert.rejects(request(p, { km: s.distance_km, exp: s.exp, sig: s.sig }), /route_not_verified/);
    await db.query("insert into public.server_secrets (name, value) values ('route_signing', $1)", [SECRET]);
  });
});
