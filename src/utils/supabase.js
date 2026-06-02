import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = supabaseUrl && supabaseAnonKey && 
                     supabaseUrl !== 'YOUR_SUPABASE_URL' && 
                     supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY';

if (!isConfigured) {
  console.warn(
    '⚠️ ORBITRIDE WARNING: Supabase connection keys are not configured or are placeholder templates. ' +
    'Falling back to high-fidelity Offline Simulation state loops. ' +
    'To connect a live backend, create a .env file containing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
