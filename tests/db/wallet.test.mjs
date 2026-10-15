// Tests for supabase/migrations/20261018000000_wallet_ledger.sql (ledger, wallet payments, top-ups, withdrawals)
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
    create table auth.users (id uuid primary key default gen_random_uuid(), phone text, raw_user_meta_data jsonb not null default '{}'::jsonb);
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

// ---- helpers ---------------------------------------------------------------

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
  return rows[0].id;
}

let adminId;
async function admin() {
  if (!adminId) {
    adminId = await newUser('passenger', 'Admin');
    await db.query("update public.profiles set role = 'admin' where id = $1", [adminId]);
  }
  return adminId;
}

async function makeDriver() {
  const a = await admin();
  const id = await newUser('driver', 'Driver');
  await asUser(id, 'select * from public.register_driver($1,$2,$3)', ['Toyota Corolla', 'N1234W', 'OrbitX']);
  await asUser(a, "select * from public.admin_set_driver_approval($1, 'approved')", [id]);
  await asUser(id, 'select * from public.set_driver_online(true)');
  await asUser(id, 'select public.update_driver_location($1,$2)', [CBD.lat + 0.002, CBD.lng]);
  return id;
}

const request = (uid, method = 'cash') =>
  asUser(uid, 'select * from public.request_ride($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    CBD.name, CBD.lat, CBD.lng, AIRPORT.name, AIRPORT.lat, AIRPORT.lng, 'OrbitX', 6.2, null, method,
  ]).then(r => r.rows[0]);

const call = (uid, fn, ...args) =>
  asUser(uid, `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args).then(r => r.rows[0]);

const wallet = (uid) => call(uid, 'my_wallet').then(w => ({ balance: Number(w.balance), held: Number(w.held), available: Number(w.available) }));

async function topUp(uid, amount) {
  const t = await call(uid, 'create_topup', amount);
  await asRole('service_role', null, 'select * from public.complete_topup($1,$2)', [t.id, `ref-${t.id}`]);
  return t;
}

async function runRide(passenger, driver, method) {
  const ride = await request(passenger, method);
  await call(driver, 'accept_ride', ride.id);
  await call(driver, 'mark_arrived', ride.id);
  await call(driver, 'start_trip', ride.id);
  return call(driver, 'complete_trip', ride.id);
}

const r2 = (n) => Math.round(n * 100) / 100;
const sumAll = () => db.query('select coalesce(sum(amount), 0) as s from public.ledger_entries').then(r => Number(r.rows[0].s));

async function enableWallet(on = true) {
  await db.query('update public.platform_settings set wallet_enabled = $1', [on]);
}

// ---- tests -------------------------------------------------------------------

describe('cash rides (the default)', () => {
  test('the driver owes the platform fee after a cash ride, and the books balance', async () => {
    const p = await newUser();
    const d = await makeDriver();
    const done = await runRide(p, d, 'cash');
    assert.equal(done.payment_method, 'cash');
    const fee = Number(done.platform_fee);
    assert.ok(fee > 0);
    assert.equal((await wallet(d)).balance, -fee);
    assert.equal((await wallet(p)).balance, 0);
    assert.equal(Number((await db.query("select balance from public.ledger_accounts where kind = 'platform'")).rows[0].balance), fee);
    assert.equal(await sumAll(), 0);
  });
});

describe('wallet switch', () => {
  test('wallet payments and top-ups are refused while the wallet is switched off', async () => {
    await enableWallet(false);
    const p = await newUser();
    await assert.rejects(request(p, 'wallet'), /wallet_disabled/);
    await assert.rejects(call(p, 'create_topup', 50), /wallet_disabled/);
    await enableWallet(true);
  });

  test('unknown payment methods are refused', async () => {
    const p = await newUser();
    await assert.rejects(request(p, 'bitcoin'), /invalid_payment_method/);
  });
});

describe('top-ups', () => {
  test('amounts outside the limits are refused', async () => {
    const p = await newUser();
    await assert.rejects(call(p, 'create_topup', 1), /invalid_amount/);
    await assert.rejects(call(p, 'create_topup', 999999), /invalid_amount/);
    await assert.rejects(call(p, 'create_topup', null), /invalid_amount/);
  });

  test('a pending top-up credits nothing; only the service role can complete one', async () => {
    const p = await newUser();
    const t = await call(p, 'create_topup', 50);
    assert.equal(t.status, 'pending');
    assert.equal((await wallet(p)).balance, 0);
    await assert.rejects(call(p, 'complete_topup', t.id, 'fake'), /permission denied/);
    await assert.rejects(asRole('anon', null, 'select * from public.complete_topup($1,$2)', [t.id, 'x']), /permission denied/);
    assert.equal((await wallet(p)).balance, 0);
  });

  test('completing credits once, however many times the webhook repeats', async () => {
    const p = await newUser();
    const t = await call(p, 'create_topup', 50);
    for (let i = 0; i < 3; i++) await asRole('service_role', null, 'select * from public.complete_topup($1,$2)', [t.id, 'gw-1']);
    assert.equal((await wallet(p)).balance, 50);
    assert.equal(await sumAll(), 0);
  });

  test('one gateway payment cannot credit two top-ups', async () => {
    const p = await newUser();
    const a = await call(p, 'create_topup', 20);
    const b = await call(p, 'create_topup', 20);
    await asRole('service_role', null, 'select * from public.complete_topup($1,$2)', [a.id, 'same-payment']);
    await assert.rejects(asRole('service_role', null, 'select * from public.complete_topup($1,$2)', [b.id, 'same-payment']), /unique|duplicate/);
    assert.equal((await wallet(p)).balance, 20);
  });

  test('a failed top-up can never be credited later', async () => {
    const p = await newUser();
    const t = await call(p, 'create_topup', 20);
    await asRole('service_role', null, 'select * from public.fail_topup($1)', [t.id]);
    await assert.rejects(asRole('service_role', null, 'select * from public.complete_topup($1,$2)', [t.id, 'late']), /topup_failed/);
    assert.equal((await wallet(p)).balance, 0);
  });
});

describe('wallet rides', () => {
  test('a passenger without enough money cannot request', async () => {
    const p = await newUser();
    await assert.rejects(request(p, 'wallet'), /insufficient_funds/);
    await db.query('update public.platform_settings set min_topup = 1');
    await topUp(p, 1);
    await assert.rejects(request(p, 'wallet'), /insufficient_funds/); // the fare is more than N$1
    await db.query('update public.platform_settings set min_topup = 10');
  });

  test('the fare is held on request and released on cancel', async () => {
    const p = await newUser();
    await topUp(p, 100);
    const ride = await request(p, 'wallet');
    const fare = Number(ride.fare);
    assert.deepEqual(await wallet(p), { balance: 100, held: fare, available: r2(100 - fare) });
    await call(p, 'cancel_ride', ride.id, 'changed my mind');
    assert.deepEqual(await wallet(p), { balance: 100, held: 0, available: 100 });
  });

  test('on completion the driver is paid, the platform takes its fee and the passenger is charged once', async () => {
    const p = await newUser();
    const d = await makeDriver();
    await topUp(p, 100);
    const done = await runRide(p, d, 'wallet');
    const fare = Number(done.fare);
    const fee = Number(done.platform_fee);
    assert.deepEqual(await wallet(p), { balance: r2(100 - fare), held: 0, available: r2(100 - fare) });
    assert.equal((await wallet(d)).balance, r2(fare - fee));
    assert.equal(Number(done.driver_payout), r2(fare - fee));
    assert.equal(await sumAll(), 0);
    // completing again is impossible, so the passenger cannot be charged twice
    await assert.rejects(call(d, 'complete_trip', done.id), /invalid_transition/);
    assert.equal((await wallet(p)).balance, r2(100 - fare));
  });

  test('a driver handing the ride back keeps the passenger funds held', async () => {
    const p = await newUser();
    const d = await makeDriver();
    await topUp(p, 100);
    const ride = await request(p, 'wallet');
    await call(d, 'accept_ride', ride.id);
    await call(d, 'release_ride', ride.id);
    assert.equal((await wallet(p)).held, Number(ride.fare));
    await call(p, 'cancel_ride', ride.id);
    assert.equal((await wallet(p)).held, 0);
  });
});

describe('driver debt limit', () => {
  test('a driver who owes too much cannot go online until they top up', async () => {
    await db.query('update public.platform_settings set driver_debt_limit = 0');
    const p = await newUser();
    const d = await makeDriver();
    await runRide(p, d, 'cash'); // the driver now owes the fee
    await call(d, 'set_driver_online', false);
    await assert.rejects(call(d, 'set_driver_online', true), /debt_limit_reached/);
    await topUp(d, 100);
    await call(d, 'set_driver_online', true);
    await db.query('update public.platform_settings set driver_debt_limit = 200');
  });

  test('a driver already online cannot accept once over the limit', async () => {
    await db.query('update public.platform_settings set driver_debt_limit = 0');
    const p = await newUser();
    const d = await makeDriver();
    const ride = await request(p, 'cash');
    await call(d, 'accept_ride', ride.id);
    await call(d, 'mark_arrived', ride.id);
    await call(d, 'start_trip', ride.id);
    await call(d, 'complete_trip', ride.id); // now in debt
    const p2 = await newUser();
    const ride2 = await request(p2, 'cash');
    await assert.rejects(call(d, 'accept_ride', ride2.id), /debt_limit_reached/);
    await call(p2, 'cancel_ride', ride2.id);
    await db.query('update public.platform_settings set driver_debt_limit = 200');
  });
});

describe('withdrawals', () => {
  async function driverWithMoney() {
    const p = await newUser();
    const d = await makeDriver();
    await topUp(p, 200);
    await runRide(p, d, 'wallet');
    return d;
  }

  test('only drivers with enough available money can ask', async () => {
    const d = await driverWithMoney();
    const bal = (await wallet(d)).balance;
    await assert.rejects(call(d, 'request_withdrawal', bal + 1), /insufficient_funds/);
    await assert.rejects(call(d, 'request_withdrawal', 0), /invalid_amount/);
    const pax = await newUser();
    await assert.rejects(call(pax, 'request_withdrawal', 5), /not_a_driver/);
  });

  test('requested money is held, and cannot be asked for twice', async () => {
    const d = await driverWithMoney();
    const bal = (await wallet(d)).balance;
    await call(d, 'request_withdrawal', bal);
    assert.deepEqual(await wallet(d), { balance: bal, held: bal, available: 0 });
    await assert.rejects(call(d, 'request_withdrawal', 1), /insufficient_funds/);
  });

  test('paying it out moves the money to external; rejecting releases it', async () => {
    const a = await admin();
    const d1 = await driverWithMoney();
    const d2 = await driverWithMoney();
    const b1 = (await wallet(d1)).balance;
    const b2 = (await wallet(d2)).balance;
    const w1 = await call(d1, 'request_withdrawal', b1);
    const w2 = await call(d2, 'request_withdrawal', b2);

    await assert.rejects(call(d1, 'admin_resolve_withdrawal', w1.id, 'paid'), /not_allowed/);
    assert.equal((await call(a, 'admin_resolve_withdrawal', w1.id, 'paid')).status, 'paid');
    assert.deepEqual(await wallet(d1), { balance: 0, held: 0, available: 0 });
    await assert.rejects(call(a, 'admin_resolve_withdrawal', w1.id, 'paid'), /invalid_transition/); // not twice

    assert.equal((await call(a, 'admin_resolve_withdrawal', w2.id, 'rejected')).status, 'rejected');
    assert.deepEqual(await wallet(d2), { balance: b2, held: 0, available: b2 });
    assert.equal(await sumAll(), 0);
  });
});

describe('manual settlement by an admin', () => {
  test('recording a payment from a driver clears what they owe, and corrections work', async () => {
    const a = await admin();
    const p = await newUser();
    const d = await makeDriver();
    const done = await runRide(p, d, 'cash');
    const owed = Number(done.platform_fee);
    assert.equal((await wallet(d)).balance, -owed);

    await assert.rejects(call(d, 'admin_record_payment', d, owed, 'self'), /not_allowed/);
    await assert.rejects(call(a, 'admin_record_payment', d, 0, 'nothing'), /invalid_amount/);
    await assert.rejects(call(a, 'admin_record_payment', p, 5, 'not a driver'), /driver_not_found/);
    await call(a, 'admin_record_payment', d, owed, 'cash handed in at the office');
    assert.equal((await wallet(d)).balance, 0);

    await call(a, 'admin_record_payment', d, -owed, 'entered twice by mistake');
    assert.equal((await wallet(d)).balance, -owed);
    const note = await asUser(d, "select note from public.ledger_entries where kind = 'adjustment' order by id desc limit 1");
    assert.equal(note.rows[0].note, 'entered twice by mistake');
    assert.equal(await sumAll(), 0);
  });
});

describe('who can see and change what', () => {
  test('people see only their own accounts and entries; an admin sees everything', async () => {
    const a = await admin();
    const p = await newUser();
    const stranger = await newUser();
    await topUp(p, 30);

    const mine = await asUser(p, 'select * from public.ledger_entries');
    assert.ok(mine.rows.length >= 1);
    assert.ok(mine.rows.every(r => Number(r.amount) > 0)); // only their own side of the transfer
    assert.equal((await asUser(stranger, 'select * from public.ledger_entries')).rows.length, 0);
    assert.equal((await asUser(stranger, 'select * from public.topups where user_id = $1', [p])).rows.length, 0);
    assert.ok((await asUser(a, 'select * from public.ledger_entries')).rows.length > mine.rows.length);
    const accounts = await asUser(stranger, 'select * from public.ledger_accounts');
    assert.ok(accounts.rows.every(r => r.owner === stranger)); // never anyone else's
  });

  test('nobody can write money records directly', async () => {
    const p = await newUser();
    await topUp(p, 30);
    await assert.rejects(asUser(p, "update public.ledger_accounts set balance = 1000000 where owner = $1", [p]).then(r => { if (r.affectedRows === 0) throw new Error('permission denied (no rows)'); }), /permission denied|no rows/);
    await assert.rejects(asUser(p, "insert into public.ledger_entries (transfer_id, account_id, amount, balance_after, kind) select gen_random_uuid(), id, 10, 10, 'topup' from public.ledger_accounts where owner = $1", [p]), /row-level security|permission denied/);
    await assert.rejects(asUser(p, "insert into public.topups (user_id, amount, status) values ($1, 100, 'paid')", [p]), /row-level security|permission denied/);
    await assert.rejects(asUser(p, 'select public.post_transfer(gen_random_uuid(), gen_random_uuid(), 5, $1)', ['topup']), /permission denied/);
    assert.equal((await wallet(p)).balance, 30);
  });

  test('ledger entries cannot be changed or deleted, even by the database owner', async () => {
    await assert.rejects(db.query('update public.ledger_entries set amount = amount + 1'), /append-only/);
    await assert.rejects(db.query('delete from public.ledger_entries'), /append-only/);
    await assert.rejects(db.query('truncate public.ledger_entries'), /append-only/);
  });

  test('the finance summary is for admins only and adds up', async () => {
    const a = await admin();
    await assert.rejects(call(await newUser(), 'admin_finance_summary'), /not_allowed/);
    const s = await call(a, 'admin_finance_summary');
    assert.ok(Number(s.platform_earned) > 0);
    assert.ok(Number(s.topped_up) > 0);
    assert.ok(Number(s.paid_out) > 0);
  });
});

describe('books always balance', () => {
  test('every transfer sums to zero and every account balance equals the sum of its entries', async () => {
    assert.equal(await sumAll(), 0);
    const { rows: unbalanced } = await db.query(
      'select transfer_id from public.ledger_entries group by transfer_id having sum(amount) <> 0'
    );
    assert.equal(unbalanced.length, 0);
    const { rows: drift } = await db.query(`
      select a.id from public.ledger_accounts a
      left join (select account_id, sum(amount) as s from public.ledger_entries group by account_id) e on e.account_id = a.id
      where a.balance <> coalesce(e.s, 0)
    `);
    assert.equal(drift.length, 0);
    const { rows: balanceAfter } = await db.query(`
      select 1 from public.ledger_entries e
      where e.balance_after <> (select sum(x.amount) from public.ledger_entries x where x.account_id = e.account_id and x.id <= e.id)
    `);
    assert.equal(balanceAfter.length, 0);
  });
});
