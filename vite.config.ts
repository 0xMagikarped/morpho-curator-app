import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG || 'rockaway',
      project: process.env.SENTRY_PROJECT || 'curator-tooling',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  define: {
    // Required for some wagmi dependencies
    'process.env': {},
  },
  optimizeDeps: {
    include: [
      // @wagmi/connectors dynamically imports this — Vite needs it pre-bundled
      '@walletconnect/ethereum-provider',
    ],
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-web3': ['wagmi', 'viem', '@tanstack/react-query'],
          'vendor-ui': ['recharts', 'lucide-react'],
          'vendor-sentry': ['@sentry/react'],
        },
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name?.includes('Page')) {
            return 'assets/pages/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
