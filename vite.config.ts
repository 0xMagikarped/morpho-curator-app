import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { alchemyUrl } from './api/_upstream.js';

/**
 * Dev-only mirror of the `api/rpc/[chainId].js` serverless proxy so
 * `npm run dev` (plain Vite, no Vercel runtime) can still resolve
 * /api/rpc/<chainId>. The Alchemy key comes from a non-VITE_ env var
 * (ALCHEMY_API_KEY in .env.local) and is used ONLY here in the Node dev
 * server — it is never exposed to the client bundle.
 */
function alchemyDevProxy(key?: string): Plugin {
  return {
    name: 'alchemy-rpc-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/rpc/')) return next();
        void (async () => {
          const url = new URL(req.url!, 'http://localhost');
          const chainId = Number(url.pathname.slice('/api/rpc/'.length));
          const fallback = url.searchParams.get('fallback');
          const upstream = alchemyUrl(chainId, key) ?? fallback;
          if (!upstream) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: `No upstream RPC for chain ${chainId} (set ALCHEMY_API_KEY in .env.local)` }));
            return;
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          try {
            const up = await fetch(upstream, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: Buffer.concat(chunks).toString(),
            });
            const text = await up.text();
            res.statusCode = up.status;
            res.setHeader('content-type', 'application/json');
            res.end(text);
          } catch {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'Upstream RPC request failed' }));
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix loads ALL env vars (incl. non-VITE_ ones) into the config
  // process only. ALCHEMY_API_KEY stays server-side; Vite still only bundles
  // VITE_-prefixed vars into the client.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      alchemyDevProxy(env.ALCHEMY_API_KEY),
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
  };
});
