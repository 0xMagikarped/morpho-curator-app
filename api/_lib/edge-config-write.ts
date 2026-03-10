const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;

export async function upsertEdgeConfigItem(key: string, value: unknown) {
  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ operation: 'upsert', key, value }],
      }),
    },
  );

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Edge Config write failed: ${JSON.stringify(error)}`);
  }

  return res.json();
}
