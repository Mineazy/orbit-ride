/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PMTILES_URL?: string;
  readonly VITE_APP_ROLE: string;
  readonly VITE_APP_MODE?: string;
  readonly VITE_BACKEND?: string;
  readonly PORT: string;
  readonly NODE_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
