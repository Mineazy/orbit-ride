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
// backend is configured. `supabase` is a live binding: it stays null until loadSupabase() resolves,
// and stays null if the backend can't be used (see below) so the app runs in offline mode.
export let supabase: SupabaseClient | null = null;

let settled = false;
let clientPromise: Promise<SupabaseClient | null> | null = null;

// RLS only allows signed-in users, so each client gets an anonymous session (restored from
// localStorage on later visits). Requires "Allow anonymous sign-ins" in the Supabase dashboard.
const connect = async (): Promise<SupabaseClient | null> => {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(supabaseUrl, supabaseAnonKey);

  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) {
      console.error(
        `⚠️ ORBITRIDE: Supabase anonymous sign-in failed (${error.message}). ` +
        'Check the URL/key and that Authentication > Providers > "Allow anonymous sign-ins" is enabled. ' +
        'Falling back to offline simulation.'
      );
      return null;
    }
  }
  return client;
};

export const loadSupabase = (): Promise<SupabaseClient | null> => {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  clientPromise ??= connect()
    .catch((err) => {
      console.error('⚠️ ORBITRIDE: Failed to initialise Supabase, using offline simulation.', err);
      return null;
    })
    .then((client) => {
      supabase = client;
      settled = true;
      return client;
    });
  return clientPromise;
};

// True while a backend is configured but the client hasn't finished loading (or failing)
export const supabasePending = (): boolean => isSupabaseConfigured && !settled;
