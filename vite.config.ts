import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { SECURITY_HEADERS } from './scripts/security-headers.mjs'

// Refuse to build a production site that is misconfigured in a way that would be unsafe or silently broken.
function productionGuard(env: Record<string, string>, mode: string) {
  return {
    name: 'orbitride-production-guard',
    buildStart() {
      const production = env.VITE_APP_MODE === 'production'
      // The in-browser test database is for development only: it has a fixed sign-in code (123456)
      if (production && env.VITE_BACKEND === 'local' && mode === 'production') {
        this.error('VITE_BACKEND=local must never be used in a production build (it accepts the sign-in code 123456).')
      }
      if (production && env.VITE_BACKEND !== 'local') {
        if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
          this.error('VITE_APP_MODE=production needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
        }
      }
      // A service-role key in a VITE_ variable would be shipped to every user's browser
      for (const [name, value] of Object.entries(env)) {
        if (!/^eyJ/.test(value ?? '')) continue
        let role: string | undefined
        try {
          role = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role
        } catch {
          /* not a JWT: fine */
        }
        if (role === 'service_role') this.error(`${name} contains a Supabase service-role key. It must never be in a VITE_ variable.`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), productionGuard(env, mode)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      // the in-browser Postgres used by the local backend ships its own wasm and must not be pre-bundled
      exclude: ['@electric-sql/pglite'],
    },
    server: {
      port: parseInt(process.env.PORT || '5173'),
      open: false,
    },
    preview: {
      host: true,
      port: parseInt(process.env.PORT || '4173'),
      allowedHosts: ['.onrender.com'],
      headers: {
        ...SECURITY_HEADERS,
        // the local test backend (never deployed) runs Postgres as WebAssembly
        ...(env.VITE_BACKEND === 'local'
          ? { 'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") }
          : {}),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
})
