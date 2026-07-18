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
  server: {
    port: Number(process.env.PORT) || 5173,
    // Allow tenant subdomains in dev, e.g. http://rit.localhost:5173.
    // *.localhost resolves to 127.0.0.1 in modern browsers with no hosts edit.
    allowedHosts: ['.localhost', '.myplacements.in'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
