import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Template values left in .env / render.yaml (YOUR_SUPABASE_URL, YOUR_..._ON_RENDER, ...) or unset variables
const isPlaceholder = (value: string | undefined): boolean =>
  !value || value === 'undefined' || value === 'null' || value.includes('YOUR_');

export const isSupabaseConfigured: boolean =
  !isPlaceholder(supabaseUrl) &&
  !isPlaceholder(supabaseAnonKey) &&
  supabaseUrl.includes('supabase.co');

if (!isSupabaseConfigured) {
  console.warn(
    '⚠️ ORBITRIDE WARNING: Supabase connection keys are not configured or are placeholder templates. ' +
    'Falling back to high-fidelity Offline Simulation state loops. ' +
    'To connect a live backend, create a .env file containing valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

// The client is created lazily so the (large) supabase-js bundle is only downloaded when a
// backend is configured. `supabase` is a live binding: it stays null until loadSupabase() resolves.
export let supabase: SupabaseClient | null = null;

let clientPromise: Promise<SupabaseClient | null> | null = null;

export const loadSupabase = (): Promise<SupabaseClient | null> => {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    return supabase;
  });
  return clientPromise;
};
