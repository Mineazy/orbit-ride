import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from './api';

// Turning push notifications on and off for this device.
//   native apps (Android, iOS): Capacitor Push Notifications plugin -> an FCM token
//   browsers:                   service worker (public/sw.js) + Web Push subscription (needs VITE_VAPID_PUBLIC_KEY)
// The token or subscription is saved on the server with register_device(); the server sends the messages.

export type PushState =
  | 'unsupported' // this browser or device cannot do push
  | 'unconfigured' // a browser build without VITE_VAPID_PUBLIC_KEY
  | 'denied' // the person refused in the system settings
  | 'off' // available, not turned on
  | 'on';

const STORAGE_KEY = 'orbitride_push_token';
const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

const remember = (token: string | null) => {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the device is simply not remembered */
  }
};
const remembered = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const native = () => Capacitor.isNativePlatform();
const webSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const swUrl = () => new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href).href;

/** Where this device stands right now, without asking for anything */
export async function getPushState(): Promise<PushState> {
  if (native()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'denied') return 'denied';
    return perm.receive === 'granted' && remembered() ? 'on' : 'off';
  }
  if (!webSupported()) return 'unsupported';
  if (!VAPID_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration(swUrl());
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

async function enableNative(): Promise<PushState> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return perm.receive === 'denied' ? 'denied' : 'off';

  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('push registration timed out')), 15000);
    void PushNotifications.addListener('registration', (t) => { clearTimeout(timer); resolve(t.value); });
    void PushNotifications.addListener('registrationError', (e) => { clearTimeout(timer); reject(new Error(e.error)); });
    void PushNotifications.register();
  });
  await api.registerDevice(Capacitor.getPlatform() === 'ios' ? 'ios' : 'android', token);
  remember(token);
  return 'on';
}

async function enableWeb(): Promise<PushState> {
  if (!VAPID_KEY) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const registration = await navigator.serviceWorker.register(swUrl());
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_KEY) }));
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.registerDevice('web', json.endpoint, { endpoint: json.endpoint, keys: json.keys });
  remember(json.endpoint);
  return 'on';
}

/** Ask permission (call this from a button press) and register this device. Throws on server errors. */
export async function enablePush(): Promise<PushState> {
  return native() ? enableNative() : enableWeb();
}

/** Stop notifications for this device: forget it on the server and drop the subscription */
export async function disablePush(): Promise<void> {
  const token = remembered();
  if (token) await api.unregisterDevice(token).catch(() => {});
  remember(null);
  if (native()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.unregister().catch(() => {});
  } else if (webSupported()) {
    const reg = await navigator.serviceWorker.getRegistration(swUrl());
    await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  }
}

/** On sign-out: stop sending this person's messages to this device (the device stays set up for the next sign-in) */
export async function releaseDevice(): Promise<void> {
  const token = remembered();
  if (token) await api.unregisterDevice(token).catch(() => {});
}

/** After sign-in: if notifications were already turned on here, attach this device to the signed-in person again */
export async function reattachDevice(): Promise<void> {
  if ((await getPushState().catch(() => 'off')) !== 'on') return;
  const token = remembered();
  if (!token) return;
  if (native()) await api.registerDevice(Capacitor.getPlatform() === 'ios' ? 'ios' : 'android', token).catch(() => {});
  else {
    const sub = await (await navigator.serviceWorker.getRegistration(swUrl()))?.pushManager.getSubscription();
    const json = sub?.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } } | undefined;
    if (json) await api.registerDevice('web', json.endpoint, { endpoint: json.endpoint, keys: json.keys }).catch(() => {});
  }
}

export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((s) => { if (!cancelled) setState(s); }).catch(() => { if (!cancelled) setState('unsupported'); });
    void reattachDevice();
    return () => { cancelled = true; };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await enablePush());
    } catch {
      setError('We could not turn notifications on. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    await disablePush();
    setState(await getPushState().catch(() => 'off' as PushState));
    setBusy(false);
  }, []);

  return { state, busy, error, enable, disable };
}
