import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Required for some wagmi dependencies
    'process.env': {},
  },
  build: {
    sourcemap: false,
  },
});
