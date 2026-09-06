import { createClient } from '@supabase/supabase-js';

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

const PLACEHOLDER_PATTERNS = ['YOUR_SUPABASE_URL', 'YOUR_SUPABASE_URL_ON_RENDER', 'YOUR_SUPABASE_ANON_KEY', 'YOUR_SUPABASE_ANON_KEY_ON_RENDER', '', 'undefined', 'null'];

const isConfigured: boolean = supabaseUrl && supabaseAnonKey &&
                       !PLACEHOLDER_PATTERNS.some(p => supabaseUrl.includes(p) || supabaseAnonKey.includes(p)) &&
                       supabaseUrl.includes('supabase.co') &&
                       !supabaseUrl.includes('YOUR_');

if (!isConfigured) {
  console.warn(
    '⚠️ ORBITRIDE WARNING: Supabase connection keys are not configured or are placeholder templates. ' +
    'Falling back to high-fidelity Offline Simulation state loops. ' +
    'To connect a live backend, create a .env file containing valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase: ReturnType<typeof createClient> | null = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
