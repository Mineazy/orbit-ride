// Delivers queued push messages. Pure logic with injected storage and senders (tested in Node, run in Deno).

import type { PushMessage, SendResult } from './fcm.ts';

export type { PushMessage, SendResult };

export interface OutboxRow {
  id: number;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
}

export interface DeviceRow {
  token: string;
  platform: 'android' | 'ios' | 'web';
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null;
}

export interface Store {
  getUnsent(id: number): Promise<OutboxRow | null>;
  listUnsent(limit: number, olderThanSeconds: number): Promise<OutboxRow[]>;
  devicesFor(userId: string): Promise<DeviceRow[]>;
  markSent(id: number): Promise<void>;
  recordAttempt(id: number): Promise<void>;
  deleteDevice(token: string): Promise<void>;
}

export type Sender = (device: DeviceRow, message: PushMessage) => Promise<SendResult>;

export interface Senders {
  /** Android and iOS apps (Firebase Cloud Messaging) */
  fcm?: Sender;
  /** Browsers (Web Push) */
  web?: Sender;
}

/** After this many failed attempts a message is dropped: an old "new ride request" is worse than none */
export const MAX_ATTEMPTS = 5;

export type Outcome = 'sent' | 'no_devices' | 'retry' | 'gave_up';

export async function deliver(store: Store, senders: Senders, row: OutboxRow): Promise<Outcome> {
  const devices = await store.devicesFor(row.user_id);
  if (devices.length === 0) {
    await store.markSent(row.id); // nobody to tell
    return 'no_devices';
  }

  const message: PushMessage = { title: row.title, body: row.body, data: row.data };
  let delivered = 0;
  let retry = 0;
  for (const device of devices) {
    const sender = device.platform === 'web' ? senders.web : senders.fcm;
    const result: SendResult = sender ? await sender(device, message) : 'retry'; // provider not configured: leave it for later
    if (result === 'ok') delivered++;
    else if (result === 'invalid') await store.deleteDevice(device.token);
    else retry++;
  }

  if (delivered > 0 || retry === 0) {
    await store.markSent(row.id);
    return delivered > 0 ? 'sent' : 'no_devices';
  }
  if (row.attempts + 1 >= MAX_ATTEMPTS) {
    await store.markSent(row.id);
    return 'gave_up';
  }
  await store.recordAttempt(row.id);
  return 'retry';
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface PushDeps {
  secret: string | undefined;
  store: Store;
  senders: Senders;
}

/**
 * POST { id }       deliver one queued message (the database calls this the moment a row is added)
 * POST { sweep: true }  retry messages that failed or were missed (call it from a schedule, for example every minute)
 * Requires the `x-push-secret` header to match PUSH_WEBHOOK_SECRET.
 */
export async function handlePush(req: Request, deps: PushDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!deps.secret || deps.secret.length < 16) return json(500, { error: 'not_configured' });
  const given = req.headers.get('x-push-secret') ?? '';
  if (!safeEqual(given, deps.secret)) return json(401, { error: 'unauthorized' });

  let body: { id?: unknown; sweep?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }

  if (body.sweep === true) {
    const rows = await deps.store.listUnsent(50, 60);
    const outcomes: Record<string, number> = {};
    for (const row of rows) {
      const o = await deliver(deps.store, deps.senders, row);
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    }
    return json(200, { processed: rows.length, outcomes });
  }

  if (typeof body.id !== 'number' || !Number.isInteger(body.id)) return json(400, { error: 'invalid_request' });
  const row = await deps.store.getUnsent(body.id);
  if (!row) return json(200, { outcome: 'already_sent_or_missing' });
  return json(200, { outcome: await deliver(deps.store, deps.senders, row) });
}
