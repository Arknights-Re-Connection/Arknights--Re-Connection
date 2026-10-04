import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/client',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
