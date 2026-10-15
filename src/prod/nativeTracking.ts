import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { LatLng } from './tracker';

// Feeds a tracker from the native background-location service (Android foreground service, iOS background location).
// The plugin is passed in, so this is tested with a fake.

export interface TrackerSink {
  position(pos: LatLng): unknown;
  error(kind: 'denied' | 'unavailable'): void;
}

export interface NativeTrackingOptions {
  /** Shown in the permanent notification (Android) while tracking runs */
  notificationTitle: string;
  notificationMessage: string;
  /** Metres the phone must move before the plugin reports again */
  distanceFilter?: number;
}

/**
 * Start watching. Returns a function that stops the watcher (safe to call before the watcher has started,
 * and more than once). Location permission is asked for by the plugin itself.
 */
export function startNativeTracking(plugin: BackgroundGeolocationPlugin, sink: TrackerSink, opts: NativeTrackingOptions): () => void {
  let stopped = false;
  let watcherId: string | null = null;

  plugin
    .addWatcher(
      {
        backgroundTitle: opts.notificationTitle,
        backgroundMessage: opts.notificationMessage,
        requestPermissions: true,
        stale: false,
        distanceFilter: opts.distanceFilter ?? 10,
      },
      (location, error) => {
        if (stopped) return;
        if (error) {
          sink.error(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
          return;
        }
        if (location) sink.position([location.latitude, location.longitude]);
      }
    )
    .then((id) => {
      if (stopped) void plugin.removeWatcher({ id }).catch(() => {}); // stopped while the watcher was starting
      else watcherId = id;
    })
    .catch(() => {
      if (!stopped) sink.error('unavailable');
    });

  return () => {
    if (stopped) return;
    stopped = true;
    if (watcherId !== null) void plugin.removeWatcher({ id: watcherId }).catch(() => {});
  };
}
