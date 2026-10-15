// Push delivery: the Firebase sender (OAuth signing, message shape, error handling) and the delivery rules.
// Network and storage are replaced by fakes, so nothing here talks to Google or a browser vendor.
//
//   npm run test:unit

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createFcmSender, signServiceAccountJwt } from '../../supabase/functions/_shared/fcm.ts';
import { deliver, handlePush, MAX_ATTEMPTS } from '../../supabase/functions/_shared/pushService.ts';

let account;
let publicKey;

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  account = { client_email: 'svc@orbit-test.iam.gserviceaccount.com', private_key: pem, project_id: 'orbit-test' };
  publicKey = pair.publicKey;
});

const b64urlJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

describe('Firebase service-account token', () => {
  test('is a valid RS256 JWT with the right claims', async () => {
    const jwt = await signServiceAccountJwt(account, 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    assert.deepEqual(b64urlJson(h), { alg: 'RS256', typ: 'JWT' });
    const claims = b64urlJson(c);
    assert.equal(claims.iss, account.client_email);
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(claims.exp - claims.iat, 3600);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
    assert.ok(ok, 'the signature must verify with the matching public key');
  });
});

// A fake Google: records requests and answers from a script
function fakeGoogle(sendStatuses = [200]) {
  const calls = { oauth: 0, sends: [] };
  let i = 0;
  const fetch = async (url, init) => {
    if (String(url).includes('oauth2')) {
      calls.oauth++;
      return new Response(JSON.stringify({ access_token: `tok-${calls.oauth}`, expires_in: 3600 }), { status: 200 });
    }
    calls.sends.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    const status = sendStatuses[Math.min(i++, sendStatuses.length - 1)];
    const body = status === 400 ? { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } } : status === 404 ? { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } : {};
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

describe('Firebase sender', () => {
  test('sends a notification with string data to the right project', async () => {
    const g = fakeGoogle();
    const send = createFcmSender({ serviceAccount: account, fetch: g.fetch, now: () => 1000 });
    assert.equal(await send('device-token-1', { title: 'Hi', body: 'There', data: { ride_id: 'abc', n: 5, nested: { a: 1 } } }), 'ok');
    const call = g.calls.sends[0];
    assert.equal(call.url, 'https://fcm.googleapis.com/v1/projects/orbit-test/messages:send');
    assert.equal(call.auth, 'Bearer tok-1');
    assert.equal(call.body.message.token, 'device-token-1');
    assert.deepEqual(call.body.message.notification, { title: 'Hi', body: 'There' });
    assert.deepEqual(call.body.message.data, { ride_id: 'abc', n: '5', nested: '{"a":1}' });
    assert.equal(call.body.message.android.priority, 'HIGH');
    assert.equal(call.body.message.apns.headers['apns-priority'], '10');
  });

  test('reuses the access token until it is about to expire', async () => {
    const g = fakeGoogle();
    let t = 1000;
    const send = createFcmSender({ serviceAccount: account, fetch: g.fetch, now: () => t });
    await send('device-token-1', { title: 'a', body: 'b' });
    await send('device-token-2', { title: 'a', body: 'b' });
    assert.equal(g.calls.oauth, 1);
    t += 3600; // past the expiry
    await send('device-token-3', { title: 'a', body: 'b' });
    assert.equal(g.calls.oauth, 2);
  });

  test('refreshes the token once when Google says it is no longer valid', async () => {
    const g = fakeGoogle([401, 200]);
    const send = createFcmSender({ serviceAccount: account, fetch: g.fetch, now: () => 1000 });
    assert.equal(await send('device-token-1', { title: 'a', body: 'b' }), 'ok');
    assert.equal(g.calls.oauth, 2);
    assert.equal(g.calls.sends.length, 2);
  });

  test('tells dead tokens apart from temporary trouble', async () => {
    const run = async (status) => createFcmSender({ serviceAccount: account, fetch: fakeGoogle([status]).fetch, now: () => 1000 })('device-token-1', { title: 'a', body: 'b' });
    assert.equal(await run(404), 'invalid'); // app removed
    assert.equal(await run(400), 'invalid'); // malformed token
    assert.equal(await run(429), 'retry');
    assert.equal(await run(500), 'retry');
    assert.equal(await run(403), 'retry'); // wrong project or permission: our setup problem, never delete devices for it
  });

  test('a network failure is a retry, never a crash', async () => {
    const send = createFcmSender({ serviceAccount: account, fetch: async () => { throw new Error('offline'); }, now: () => 1000 });
    assert.equal(await send('device-token-1', { title: 'a', body: 'b' }), 'retry');
  });
});

// ---- delivery rules ----------------------------------------------------------

function fakeStore(devices, row = { id: 1, user_id: 'u1', title: 'T', body: 'B', data: { type: 'x' }, attempts: 0 }) {
  const log = { sent: [], attempts: [], deleted: [] };
  const store = {
    log, row,
    getUnsent: async (id) => (id === row.id && !log.sent.includes(id) ? row : null),
    listUnsent: async () => (log.sent.includes(row.id) ? [] : [row]),
    devicesFor: async () => devices,
    markSent: async (id) => { log.sent.push(id); },
    recordAttempt: async (id) => { log.attempts.push(id); },
    deleteDevice: async (t) => { log.deleted.push(t); },
  };
  return store;
}
const android = { token: 'android-token-1', platform: 'android', subscription: null };
const ios = { token: 'ios-token-0001', platform: 'ios', subscription: null };
const browser = { token: 'https://push.example/1', platform: 'web', subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } };
const ok = async () => 'ok';
const invalid = async () => 'invalid';
const retry = async () => 'retry';

describe('delivery rules', () => {
  test('sends to every device of the person, using the right provider for each', async () => {
    const used = [];
    const store = fakeStore([android, ios, browser]);
    const out = await deliver(store, { fcm: async (d) => (used.push(`fcm:${d.platform}`), 'ok'), web: async (d) => (used.push('web'), 'ok') }, store.row);
    assert.equal(out, 'sent');
    assert.deepEqual(used, ['fcm:android', 'fcm:ios', 'web']);
    assert.deepEqual(store.log.sent, [1]);
  });

  test('passes the message title, body and data through', async () => {
    let seen;
    const store = fakeStore([android]);
    await deliver(store, { fcm: async (_d, m) => (seen = m, 'ok') }, store.row);
    assert.deepEqual(seen, { title: 'T', body: 'B', data: { type: 'x' } });
  });

  test('a person with no devices is finished at once', async () => {
    const store = fakeStore([]);
    assert.equal(await deliver(store, {}, store.row), 'no_devices');
    assert.deepEqual(store.log.sent, [1]);
  });

  test('dead devices are removed, and one success is enough to finish', async () => {
    const store = fakeStore([android, browser]);
    const out = await deliver(store, { fcm: invalid, web: ok }, store.row);
    assert.equal(out, 'sent');
    assert.deepEqual(store.log.deleted, ['android-token-1']);
    assert.deepEqual(store.log.sent, [1]);
  });

  test('when every device is dead the message is finished (nothing left to try)', async () => {
    const store = fakeStore([android, ios]);
    assert.equal(await deliver(store, { fcm: invalid }, store.row), 'no_devices');
    assert.deepEqual(store.log.deleted.sort(), ['android-token-1', 'ios-token-0001']);
    assert.deepEqual(store.log.sent, [1]);
  });

  test('temporary failures are retried, then given up after the limit', async () => {
    const store = fakeStore([android]);
    assert.equal(await deliver(store, { fcm: retry }, store.row), 'retry');
    assert.deepEqual(store.log.attempts, [1]);
    assert.deepEqual(store.log.sent, []);
    const tired = fakeStore([android], { id: 2, user_id: 'u1', title: 'T', body: 'B', data: {}, attempts: MAX_ATTEMPTS - 1 });
    assert.equal(await deliver(tired, { fcm: retry }, tired.row), 'gave_up');
    assert.deepEqual(tired.log.sent, [2]);
  });

  test('a provider that is not configured is a retry, and never deletes the device', async () => {
    const store = fakeStore([android, browser]);
    assert.equal(await deliver(store, {}, store.row), 'retry');
    assert.deepEqual(store.log.deleted, []);
  });
});

describe('webhook handler', () => {
  const SECRET = 'a-long-shared-secret-value';
  const req = (body, headers = { 'x-push-secret': SECRET }, method = 'POST') =>
    new Request('http://x/send-push', { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });

  test('refuses calls without the shared secret', async () => {
    const store = fakeStore([android]);
    const deps = { secret: SECRET, store, senders: { fcm: ok } };
    assert.equal((await handlePush(req({ id: 1 }, {}), deps)).status, 401);
    assert.equal((await handlePush(req({ id: 1 }, { 'x-push-secret': 'wrong-secret-value-xx' }), deps)).status, 401);
    assert.equal((await handlePush(req({}, {}, 'GET'), deps)).status, 405);
    assert.deepEqual(store.log.sent, []);
  });

  test('refuses to run with a missing or weak secret', async () => {
    const store = fakeStore([android]);
    assert.equal((await handlePush(req({ id: 1 }), { secret: undefined, store, senders: {} })).status, 500);
    assert.equal((await handlePush(req({ id: 1 }, { 'x-push-secret': 'short' }), { secret: 'short', store, senders: {} })).status, 500);
  });

  test('delivers one message by id, and ignores one already sent', async () => {
    const store = fakeStore([android]);
    const deps = { secret: SECRET, store, senders: { fcm: ok } };
    assert.deepEqual(await (await handlePush(req({ id: 1 }), deps)).json(), { outcome: 'sent' });
    assert.deepEqual(await (await handlePush(req({ id: 1 }), deps)).json(), { outcome: 'already_sent_or_missing' });
  });

  test('rejects malformed requests', async () => {
    const deps = { secret: SECRET, store: fakeStore([android]), senders: {} };
    for (const body of [{}, { id: 'one' }, { id: 1.5 }]) assert.equal((await handlePush(req(body), deps)).status, 400);
    const bad = new Request('http://x', { method: 'POST', headers: { 'x-push-secret': SECRET }, body: 'nope' });
    assert.equal((await handlePush(bad, deps)).status, 400);
  });

  test('a sweep retries everything that is waiting', async () => {
    const store = fakeStore([android]);
    const res = await handlePush(req({ sweep: true }), { secret: SECRET, store, senders: { fcm: ok } });
    assert.deepEqual(await res.json(), { processed: 1, outcomes: { sent: 1 } });
  });
});
