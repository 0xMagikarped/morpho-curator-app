import { get } from '@vercel/edge-config';

export const config = {
  runtime: 'edge',
};

export default async function handler() {
  const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
  const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
  const EDGE_CONFIG = process.env.EDGE_CONFIG;

  const testKey = 'test_roundtrip';
  const testValue = { timestamp: Date.now(), test: true };

  // Step 1: Write via REST API
  let writeStatus = 0;
  let writeBody = '';
  try {
    const writeRes = await fetch(
      `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${VERCEL_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [{ operation: 'upsert', key: testKey, value: testValue }],
        }),
      },
    );
    writeStatus = writeRes.status;
    writeBody = await writeRes.text();
  } catch (err: unknown) {
    writeBody = err instanceof Error ? err.message : String(err);
  }

  // Step 2: Brief wait for propagation
  await new Promise((r) => setTimeout(r, 2000));

  // Step 3: Read back via SDK
  let readResult: unknown = null;
  let readError = '';
  try {
    readResult = await get(testKey);
  } catch (err: unknown) {
    readError = err instanceof Error ? err.message : String(err);
  }

  return new Response(
    JSON.stringify(
      {
        env: {
          EDGE_CONFIG: EDGE_CONFIG ? `${EDGE_CONFIG.substring(0, 40)}...` : 'MISSING',
          EDGE_CONFIG_ID: EDGE_CONFIG_ID ? `${EDGE_CONFIG_ID.substring(0, 15)}...` : 'MISSING',
          VERCEL_API_TOKEN: VERCEL_API_TOKEN ? 'SET' : 'MISSING',
        },
        write: {
          status: writeStatus,
          body: writeBody,
        },
        readBack: readResult,
        readError: readError || undefined,
        testValue,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
