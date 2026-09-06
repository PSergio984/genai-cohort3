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
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
