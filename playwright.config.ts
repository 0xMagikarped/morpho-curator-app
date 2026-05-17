import { defineConfig } from '@playwright/test';

// When BASE_URL is set (e.g. a Vercel preview URL) the suite targets that
// deployment and the local dev server is NOT started — required for the CSP
// spec, since `vercel.json` headers are only emitted by the Vercel edge, not
// by `vite dev`/`preview`.
const externalBaseURL = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: externalBaseURL ?? 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          port: 5173,
          reuseExistingServer: true,
        },
      }),
});
