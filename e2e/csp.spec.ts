/**
 * PR 3 — live CSP-enforcement proof.
 *
 * SKIPPED unless BASE_URL is set, because `vercel.json` headers are emitted
 * only by the Vercel edge — `vite dev`/`preview` would give a false pass.
 * Run against a pushed Vercel preview:
 *
 *   BASE_URL=https://<preview>.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<token-if-deployment-protection-on> \
 *   npx playwright test e2e/csp.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL;
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

// Deployment-Protection bypass header (no-op if Protection is off).
const extraHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};

const ROUTES = ['/', '/markets', '/create', '/market/create', '/oracle/decode', '/settings'];

test.describe('CSP is enforced on the live deployment (audit §4)', () => {
  test.skip(!BASE_URL, 'Set BASE_URL to a Vercel preview URL to run the live CSP check.');

  test('enforced CSP + HSTS headers are present (not Report-Only)', async ({ request }) => {
    const res = await request.get(BASE_URL!, { headers: extraHeaders });
    const headers = res.headers();
    expect(headers['content-security-policy'], 'CSP must be enforced').toBeTruthy();
    expect(
      headers['content-security-policy-report-only'],
      'Report-Only must be gone',
    ).toBeUndefined();
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['content-security-policy']).not.toContain("'unsafe-eval'");
  });

  test('no CSP violations across the main routes (RPC/data calls not blocked)', async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders(extraHeaders);
    const violations: string[] = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to connect|violates the following/i.test(t)) {
        violations.push(`${page.url()} :: ${t}`);
      }
    });
    page.on('pageerror', (err) => {
      if (/Content Security Policy/i.test(err.message)) {
        violations.push(`${page.url()} :: ${err.message}`);
      }
    });

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    }

    expect(violations, `CSP blocked legitimate requests:\n${violations.join('\n')}`).toEqual([]);
  });
});
