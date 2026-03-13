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
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-web3': ['wagmi', 'viem', '@tanstack/react-query'],
          'vendor-ui': ['recharts', 'lucide-react'],
        },
      },
    },
  },
});
