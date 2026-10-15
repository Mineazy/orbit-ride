import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../utils/supabase';

// Which backend the production apps talk to:
//   supabase (default): the real project in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//   local:              an in-browser Postgres that runs the real migration, for development and demos
//                       (set VITE_BACKEND=local). It never ships in a production build.
export const BACKEND_KIND: 'local' | 'supabase' = import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'supabase';

export const isBackendConfigured = (): boolean => BACKEND_KIND === 'local' || isSupabaseConfigured;

let clientPromise: Promise<SupabaseClient> | null = null;

export function getBackend(): Promise<SupabaseClient> {
  clientPromise ??= (async () => {
    if (import.meta.env.VITE_BACKEND === 'local') {
      const { createLocalClient } = await import('./localBackend');
      const migration = (await import('../../supabase/migrations/20261015000000_foundation.sql?raw')).default;
      return (await createLocalClient({ migrationSql: migration })) as unknown as SupabaseClient;
    }
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  })();
  return clientPromise;
}
