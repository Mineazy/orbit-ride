import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { calculateDistance } from '../utils/routing';
import { api } from './api';
import { BACKEND_KIND } from './backend';
import { startNativeTracking } from './nativeTracking';
import { createTracker, DEFAULTS, type GpsState } from './tracker';

export type { GpsState };

// Where a development browser without GPS pretends to be (central Windhoek). Never used against a real backend.
const DEV_FALLBACK: [number, number] = [-22.5609, 17.0658];

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** True in the Android and iOS apps, where location keeps working with the app closed or the phone locked */
export const hasBackgroundLocation = (): boolean => Capacitor.isNativePlatform();

/**
 * While `active`, send the device position to the server (update_driver_location).
 *   Android and iOS apps: a native background service, so it keeps going with the screen off or another app on top.
 *   Browsers: the page's own location watch, which stops when the tab or app goes to the background.
 * Reports whether location is working so the screen can tell the driver when it is not.
 * `onFix` receives each position that was sent.
 */
export function useDriverTracking(active: boolean, onFix?: (pos: [number, number]) => void): GpsState {
  const [state, setState] = useState<GpsState>('off');
  const onFixRef = useRef(onFix);
  useEffect(() => {
    onFixRef.current = onFix;
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const set = (next: GpsState) => { if (!stopped) setState(next); };

    const tracker = createTracker({
      send: async (pos) => { await api.updateLocation(pos[0], pos[1]); },
      onState: set,
      onFix: (pos) => onFixRef.current?.(pos),
      now: () => Date.now(),
      distance: calculateDistance,
    });
    // a parked driver sends nothing new, so re-send the last position now and then
    const heartbeat = setInterval(() => void tracker.heartbeat(), 10_000);
    queueMicrotask(() => set('waiting'));

    let stopSource: () => void = () => {};

    if (hasBackgroundLocation()) {
      stopSource = startNativeTracking(BackgroundGeolocation, tracker, {
        notificationTitle: 'OrbitRide is sharing your location',
        notificationMessage: 'You are online. Go offline in the app to stop.',
      });
    } else if (!('geolocation' in navigator)) {
      if (BACKEND_KIND === 'local') {
        void tracker.position(DEV_FALLBACK);
        const dev = setInterval(() => void tracker.position(DEV_FALLBACK), DEFAULTS.heartbeatMs);
        stopSource = () => clearInterval(dev);
        set('ok');
      } else {
        queueMicrotask(() => set('unavailable'));
      }
    } else {
      let devTimer: ReturnType<typeof setInterval> | undefined;
      const watchId = navigator.geolocation.watchPosition(
        (p) => void tracker.position([p.coords.latitude, p.coords.longitude]),
        (err) => {
          if (BACKEND_KIND === 'local' && devTimer === undefined) {
            void tracker.position(DEV_FALLBACK);
            devTimer = setInterval(() => void tracker.position(DEV_FALLBACK), DEFAULTS.heartbeatMs);
            set('ok');
            return;
          }
          tracker.error(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
      );
      stopSource = () => { navigator.geolocation.clearWatch(watchId); clearInterval(devTimer); };
    }

    return () => {
      stopped = true;
      tracker.stop();
      clearInterval(heartbeat);
      stopSource();
    };
  }, [active]);

  return active ? state : 'off';
}

/** One-off position for the passenger's "use my location" pickup. Resolves null when unavailable or refused. */
export function currentPosition(): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(BACKEND_KIND === 'local' ? DEV_FALLBACK : null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      () => resolve(BACKEND_KIND === 'local' ? DEV_FALLBACK : null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
    );
  });
}

export const GPS_MESSAGES: Record<GpsState, string | null> = {
  off: null,
  waiting: 'Finding your location...',
  ok: null,
  denied: 'Location is blocked. In your phone settings allow location for this app ("Allow all the time" if offered) to receive ride requests.',
  unavailable: 'We cannot find your location. Move to an open area or check that location is switched on.',
};
