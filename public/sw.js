// OrbitRide service worker: shows push notifications when the app is not on screen.
// Registered by src/prod/push.ts only after the person turns notifications on.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Safari/iOS require every push to show a notification; other browsers let us stay quiet while the app is on screen
// (the app already beeps and vibrates by itself then).
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(self.navigator.userAgent);

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { title: 'OrbitRide', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (!isSafari && windows.some((w) => w.visibilityState === 'visible')) return;
      const data = message.data || {};
      await self.registration.showNotification(message.title || 'OrbitRide', {
        body: message.body || '',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: data.ride_id || 'orbitride', // a newer message about the same ride replaces the older one
        data,
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) if ('focus' in w) return w.focus();
      return self.clients.openWindow(self.registration.scope);
    })()
  );
});
