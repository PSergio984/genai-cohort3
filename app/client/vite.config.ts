import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output replaces app/public (emptyOutDir), which Express serves via
// express.static with no server changes. API contracts are untouched.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Backend routes needed during `npm run dev` (the backend must run too).
      '/api': 'http://127.0.0.1:8080',
      '/firebase-config.js': 'http://127.0.0.1:8080',
      '/maps-config.js': 'http://127.0.0.1:8080',
    },
  },
});
