import { useEffect, useRef, useState } from 'react';
import { calculateDistance } from '../utils/routing';
import { api } from './api';
import { BACKEND_KIND } from './backend';

export type GpsState = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable';

// Where a development browser without GPS pretends to be (central Windhoek). Never used against a real backend.
const DEV_FALLBACK: [number, number] = [-22.5609, 17.0658];

const MIN_GAP_MS = 5_000; // never send more often than this
const HEARTBEAT_MS = 30_000; // send even when parked, so the server knows we are still here
const MIN_MOVE_KM = 0.01; // 10 m

/**
 * While `active`, watch the device position and send it to the server (update_driver_location).
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
    let last: { at: number; pos: [number, number] } | null = null;
    let sending = false;
    let watchId: number | null = null;
    let devTimer: ReturnType<typeof setInterval> | undefined;

    const push = async (pos: [number, number]) => {
      const now = Date.now();
      if (sending) return;
      if (last) {
        const gap = now - last.at;
        const moved = calculateDistance(last.pos, pos) >= MIN_MOVE_KM;
        if (gap < MIN_GAP_MS || (!moved && gap < HEARTBEAT_MS)) return;
      }
      sending = true;
      try {
        await api.updateLocation(pos[0], pos[1]);
        last = { at: now, pos };
        if (!stopped) {
          setState('ok');
          onFixRef.current?.(pos);
        }
      } catch {
        /* a failed ping is retried by the next position */
      } finally {
        sending = false;
      }
    };

    const startDevFallback = () => {
      void push(DEV_FALLBACK);
      devTimer = setInterval(() => void push(DEV_FALLBACK), HEARTBEAT_MS);
      setState('ok');
    };

    queueMicrotask(() => !stopped && setState('waiting'));

    if (!('geolocation' in navigator)) {
      if (BACKEND_KIND === 'local') startDevFallback();
      else queueMicrotask(() => !stopped && setState('unavailable'));
    } else {
      watchId = navigator.geolocation.watchPosition(
        (p) => void push([p.coords.latitude, p.coords.longitude]),
        (err) => {
          if (stopped) return;
          if (BACKEND_KIND === 'local' && devTimer === undefined) return startDevFallback();
          setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
      );
    }

    return () => {
      stopped = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearInterval(devTimer);
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
  denied: 'Location is blocked. Allow location for this app in your phone settings to receive ride requests.',
  unavailable: 'We cannot find your location. Move to an open area or check that location is switched on.',
};
