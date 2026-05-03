import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev=8001 / release=8002。シェル変数 TRAINER_PORT または .env の TRAINER_PORT で切替。
const backendPort = process.env['TRAINER_PORT'] ?? '8001'
const proxyTarget = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,          // dev
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,          // release (npm run preview)
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
    },
  },
})
