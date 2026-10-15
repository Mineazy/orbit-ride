import { useEffect, useRef } from 'react';

// In-app alerts: a short beep, a vibration and (when allowed) a system notification.
// These work while the app is open or in the background of a browser tab. Alerts for a fully closed native app
// need push (FCM / APNs), which needs your own credentials; see docs/production-roadmap.md.

let audio: AudioContext | null = null;

function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.4);
  } catch {
    /* audio may be blocked until the person has touched the page */
  }
}

export function alertUser(title: string, body?: string) {
  beep();
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* ignore */
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, tag: 'orbitride' });
    }
  } catch {
    /* ignore */
  }
}

/** Ask once for permission to show system notifications (call from a button press) */
export function askNotificationPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/**
 * Android 13+ only shows the "OrbitRide is sharing your location" notification if notifications are allowed.
 * Ask once (the first time a driver goes online) so the background service is visible. No-op in browsers and on iOS.
 */
export async function requestForegroundNotificationPermission(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() !== 'android') return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') await PushNotifications.requestPermissions();
  } catch {
    /* the service still runs; only its notification may be hidden */
  }
}

/**
 * Fires `alertUser` when `key` changes to a non-null value that has a message.
 * The first value seen on load is remembered silently, so opening the app does not ring.
 */
export function useChangeAlert(key: string | null, message: (key: string) => { title: string; body?: string } | null) {
  const seen = useRef<string | null | undefined>(undefined);
  const messageRef = useRef(message);
  useEffect(() => {
    messageRef.current = message;
  });
  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = key;
      return;
    }
    if (key === seen.current) return;
    seen.current = key;
    if (key === null) return;
    const m = messageRef.current(key);
    if (m) alertUser(m.title, m.body);
  }, [key]);
}
