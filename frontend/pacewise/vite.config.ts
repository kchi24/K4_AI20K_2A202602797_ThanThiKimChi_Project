import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PaceWise frontend. HashRouter is used so the build can be hosted as static files.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
