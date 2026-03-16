import { http, HttpResponse } from 'msw';

function getMockRpcResult(method: string) {
  switch (method) {
    case 'eth_blockNumber':
      return '0x1234567';
    case 'eth_chainId':
      return '0x1';
    case 'eth_call':
      return '0x0000000000000000000000000000000000000000000000000000000000000001';
    case 'eth_getBalance':
      return '0x56bc75e2d63100000'; // 100 ETH
    default:
      return '0x';
  }
}

// Catch-all RPC handler for all providers
const rpcHandler = http.post('https://*', async ({ request }) => {
  const url = new URL(request.url);
  // Only intercept known RPC endpoints
  if (
    !url.hostname.includes('publicnode.com') &&
    !url.hostname.includes('public-rpc.com') &&
    !url.hostname.includes('ankr.com') &&
    !url.hostname.includes('base.org') &&
    !url.hostname.includes('sei-apis.com') &&
    !url.hostname.includes('infura.io')
  ) {
    // Check if it's the Morpho API
    if (url.hostname === 'blue-api.morpho.org') {
      return handleMorphoApi(request);
    }
    return;
  }

  const body = (await request.json()) as Record<string, unknown>;

  if (Array.isArray(body)) {
    return HttpResponse.json(
      body.map((req: Record<string, unknown>) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: getMockRpcResult(req.method as string),
      })),
    );
  }

  return HttpResponse.json({
    jsonrpc: '2.0',
    id: body.id,
    result: getMockRpcResult(body.method as string),
  });
});

async function handleMorphoApi(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const query = (body.query as string) || '';

  if (query.includes('vaults')) {
    return HttpResponse.json({
      data: {
        vaults: {
          items: [
            {
              address: '0x1234567890123456789012345678901234567890',
              symbol: 'steakUSDC',
              name: 'Steakhouse USDC',
              state: {
                totalAssets: '1000000000000',
                totalSupply: '1000000000000',
                apy: 0.0542,
              },
              asset: {
                symbol: 'USDC',
                decimals: 6,
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              },
              chain: { id: 1 },
            },
          ],
        },
      },
    });
  }

  return HttpResponse.json({ data: {} });
}

// Morpho GraphQL API handler
const morphoApiHandler = http.post(
  'https://blue-api.morpho.org/graphql',
  async ({ request }) => {
    return handleMorphoApi(request);
  },
);

export const handlers = [morphoApiHandler, rpcHandler];
