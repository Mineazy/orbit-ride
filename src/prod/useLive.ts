import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBackend } from './backend';
import { errorMessage } from './errors';

interface LiveState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load data and keep it fresh: refetch when the tables change (realtime) and on a slow timer as a safety net.
 * `load` receives the client and returns the data; it may read several tables.
 */
export function useLive<T>(
  load: (client: SupabaseClient) => Promise<T>,
  deps: unknown[] = [],
  tables: string[] = ['rides', 'driver_profiles'],
  pollMs = 15000
): LiveState<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<LiveState<T>>({ data: null, loading: true, error: null });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load; // always call the latest loader without re-subscribing
  });
  const busy = useRef(false);
  const again = useRef(false);

  const running = useRef<Promise<void> | null>(null);

  const reload = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true; // a change arrived mid-load: run once more afterwards
      return running.current; // callers wait for that run, so they see fresh data when they resume
    }
    busy.current = true;
    running.current = (async () => {
      try {
        do {
          again.current = false;
          try {
            const client = await getBackend();
            const data = await loadRef.current(client);
            setState({ data, loading: false, error: null });
          } catch (err) {
            setState((s) => ({ ...s, loading: false, error: errorMessage(err) }));
          }
        } while (again.current);
      } finally {
        busy.current = false;
        running.current = null;
      }
    })();
    return running.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      await reload();
      const client = await getBackend();
      if (cancelled) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void reload(), 150); // collapse bursts of events
      };
      let channel = client.channel(`live-${Math.random().toString(36).slice(2)}`);
      for (const table of tables) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
      }
      channel.subscribe();
      const poll = setInterval(() => void reload(), pollMs);
      teardown = () => {
        clearTimeout(timer);
        clearInterval(poll);
        void client.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}
