// The rules for sending a driver's position to the server, independent of where the position comes from
// (browser, native background service, development fallback). Pure, so it is tested without a phone.

export type LatLng = [number, number];
export type GpsState = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable';

export interface TrackerOptions {
  /** Send one position to the server. May throw: a failed ping is simply retried by the next position or heartbeat. */
  send: (pos: LatLng) => Promise<void>;
  onState: (state: GpsState) => void;
  /** Called with every position that was sent */
  onFix?: (pos: LatLng) => void;
  now: () => number;
  /** Distance in km between two positions */
  distance: (a: LatLng, b: LatLng) => number;
  minGapMs?: number;
  heartbeatMs?: number;
  minMoveKm?: number;
}

export const DEFAULTS = {
  minGapMs: 5_000, // never send more often than this
  heartbeatMs: 30_000, // send even when parked, so the server knows we are still here (it forgets drivers after 5 minutes)
  minMoveKm: 0.01, // 10 m
};

export function createTracker(opts: TrackerOptions) {
  const minGap = opts.minGapMs ?? DEFAULTS.minGapMs;
  const heartbeat = opts.heartbeatMs ?? DEFAULTS.heartbeatMs;
  const minMove = opts.minMoveKm ?? DEFAULTS.minMoveKm;

  let stopped = false;
  let sending = false;
  let latest: LatLng | null = null;
  let last: { at: number; pos: LatLng } | null = null;

  async function push(pos: LatLng): Promise<void> {
    if (stopped || sending) return;
    const now = opts.now();
    if (last) {
      const gap = now - last.at;
      const moved = opts.distance(last.pos, pos) >= minMove;
      if (gap < minGap || (!moved && gap < heartbeat)) return;
    }
    sending = true;
    try {
      await opts.send(pos);
      last = { at: now, pos };
      if (!stopped) {
        opts.onState('ok');
        opts.onFix?.(pos);
      }
    } catch {
      /* retried by the next position or heartbeat */
    } finally {
      sending = false;
    }
  }

  return {
    /** A new position arrived from the device */
    position(pos: LatLng): Promise<void> {
      latest = pos;
      return push(pos);
    },
    /** Call every few seconds: re-sends the last position if nothing has been sent for a while (parked driver, phone in a pocket) */
    heartbeat(): Promise<void> {
      if (!latest || !last || opts.now() - last.at < heartbeat) return Promise.resolve();
      return push(latest);
    },
    /** The device could not give a position */
    error(kind: 'denied' | 'unavailable'): void {
      if (!stopped) opts.onState(kind);
    },
    stop(): void {
      stopped = true;
    },
  };
}
