/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PMTILES_URL?: string;
  readonly VITE_APP_ROLE: string;
  readonly VITE_APP_MODE?: string;
  readonly VITE_COMPANY_NAME?: string;
  readonly VITE_COMPANY_ADDRESS?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_SUPPORT_PHONE?: string;
  readonly VITE_LEGAL_REVIEWED?: string;
  readonly VITE_LEGAL_UPDATED?: string;
  readonly VITE_BACKEND?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly PORT: string;
  readonly NODE_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
