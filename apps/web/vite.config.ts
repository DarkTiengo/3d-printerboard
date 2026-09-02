import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // em dev o front roda separado; a API e os streams vão para o Fastify
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
        // SSE e MJPEG precisam passar sem buffer
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
