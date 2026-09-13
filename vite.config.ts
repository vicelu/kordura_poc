import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const API_PORT = process.env.API_PORT ?? '8787'

export default defineConfig({
  root: 'web',
  // Sub-path for the static demo on GitHub Pages (https://<user>.github.io/<repo>/).
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
})
