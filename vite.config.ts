import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    port: parseInt(process.env.PORT || '5173'),
    open: false,
  },
  preview: {
    host: true,
    port: parseInt(process.env.PORT || '4173'),
    allowedHosts: ['.onrender.com'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
