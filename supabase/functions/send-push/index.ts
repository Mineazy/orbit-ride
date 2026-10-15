// Edge function: delivers queued push notifications (see docs/push-notifications.md).
//
// Deploy:   supabase functions deploy send-push --no-verify-jwt
//           (it is called by the database with a shared secret header, not by signed-in users)
// Secrets:  supabase secrets set PUSH_WEBHOOK_SECRET=<long random>
//             FCM_SERVICE_ACCOUNT='<the whole Firebase service-account JSON>'      (Android and iOS apps)
//             VAPID_PUBLIC_KEY=<..> VAPID_PRIVATE_KEY=<..> VAPID_SUBJECT=mailto:you@example.com   (browsers)
//           SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to functions automatically.
// Either provider may be left out; messages for a provider that is not configured simply wait and then expire.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { createFcmSender, type ServiceAccount } from '../_shared/fcm.ts';
import { handlePush, type DeviceRow, type OutboxRow, type Senders, type Store } from '../_shared/pushService.ts';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

const store: Store = {
  async getUnsent(id) {
    const { data } = await db.from('push_outbox').select('*').eq('id', id).is('sent_at', null).maybeSingle();
    return (data as OutboxRow | null) ?? null;
  },
  async listUnsent(limit, olderThanSeconds) {
    const before = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
    const { data } = await db.from('push_outbox').select('*').is('sent_at', null).lt('created_at', before).order('id').limit(limit);
    return (data as OutboxRow[] | null) ?? [];
  },
  async devicesFor(userId) {
    const { data } = await db.from('device_tokens').select('token, platform, subscription').eq('user_id', userId);
    return (data as DeviceRow[] | null) ?? [];
  },
  async markSent(id) {
    await db.from('push_outbox').update({ sent_at: new Date().toISOString() }).eq('id', id);
  },
  async recordAttempt(id) {
    const { data } = await db.from('push_outbox').select('attempts').eq('id', id).maybeSingle();
    await db.from('push_outbox').update({ attempts: ((data as { attempts: number } | null)?.attempts ?? 0) + 1 }).eq('id', id);
  },
  async deleteDevice(token) {
    await db.from('device_tokens').delete().eq('token', token);
  },
};

const senders: Senders = {};

const fcmJson = Deno.env.get('FCM_SERVICE_ACCOUNT');
if (fcmJson) {
  const sendFcm = createFcmSender({ serviceAccount: JSON.parse(fcmJson) as ServiceAccount });
  senders.fcm = (device, message) => sendFcm(device.token, message);
}

const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@example.com', vapidPublic, vapidPrivate);
  senders.web = async (device, message) => {
    if (!device.subscription) return 'invalid';
    try {
      await webpush.sendNotification(device.subscription, JSON.stringify(message), { TTL: 3600, urgency: 'high' });
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'invalid' : 'retry';
    }
  };
}

Deno.serve((req: Request) => handlePush(req, { secret: Deno.env.get('PUSH_WEBHOOK_SECRET'), store, senders }));
