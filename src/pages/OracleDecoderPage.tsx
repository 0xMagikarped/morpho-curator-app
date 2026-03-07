import { useState } from 'react';
import { isAddress, type Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { getSupportedChainIds, getChainConfig } from '../config/chains';
import { decodeOracle, type DecodedOracle, type DecodedFeed, type DecodedVault } from '../lib/oracle/oracleDecoder';
import { truncateAddress } from '../lib/utils/format';

function formatStaleness(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function FeedCard({ label, address, feed, chainId }: { label: string; address: Address; feed: DecodedFeed | null; chainId: number }) {
  const ZERO = '0x0000000000000000000000000000000000000000';
  const chainConfig = getChainConfig(chainId);
  const isZero = address === ZERO;

  return (
    <div className="bg-bg-elevated rounded-md p-3 border border-border-subtle/50">
      <p className="text-[10px] text-text-tertiary uppercase font-mono mb-2">{label}</p>
      {isZero ? (
        <p className="text-xs text-text-tertiary italic">Zero address (returns 1)</p>
      ) : feed ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{feed.description}</p>
          <p className="text-xs text-text-secondary">
            Answer: <span className="font-mono">{feed.latestAnswer.toString()}</span>
          </p>
          <p className="text-xs text-text-secondary">
            Decimals: <span className="font-mono">{feed.decimals}</span>
          </p>
          <p className="text-xs text-text-secondary">
            Staleness: <span className={feed.staleness > 86400 ? 'text-danger' : feed.staleness > 3600 ? 'text-warning' : 'text-success'}>
              {formatStaleness(feed.staleness)}
            </span>
          </p>
          <a
            href={`${chainConfig?.blockExplorer}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-info hover:text-info/80 font-mono"
          >
            {truncateAddress(address, 4)}
          </a>
        </div>
      ) : (
        <div>
          <p className="text-xs text-warning">Failed to read feed</p>
          <p className="text-[10px] text-text-tertiary font-mono">{truncateAddress(address, 4)}</p>
        </div>
      )}
    </div>
  );
}

function VaultCard({ label, vault, sample, chainId }: { label: string; vault: DecodedVault; sample: bigint; chainId: number }) {
  const chainConfig = getChainConfig(chainId);
  return (
    <div className="bg-bg-elevated rounded-md p-3 border border-border-subtle/50">
      <p className="text-[10px] text-text-tertiary uppercase font-mono mb-2">{label}</p>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-primary">{vault.name}</p>
        <p className="text-xs text-text-secondary">
          Sample: <span className="font-mono">{sample.toString()}</span>
        </p>
        <p className="text-xs text-text-secondary">
          Assets/Share: <span className="font-mono">{vault.assetsPerShare.toString()}</span>
        </p>
        <a
          href={`${chainConfig?.blockExplorer}/address/${vault.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-info hover:text-info/80 font-mono"
        >
          {truncateAddress(vault.address, 4)}
        </a>
      </div>
    </div>
  );
}

function OracleResults({ oracle }: { oracle: DecodedOracle }) {
  const chainConfig = getChainConfig(oracle.chainId);

  return (
    <div className="space-y-4">
      {/* Classification & Price */}
      <Card>
        <CardHeader>
          <CardTitle>Oracle Overview</CardTitle>
          <Badge>{oracle.classification}</Badge>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-text-tertiary uppercase font-mono">Price (raw)</p>
            <p className="text-sm font-medium text-text-primary font-mono break-all">
              {oracle.price.toString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase font-mono">Price (&times;10&#8315;&sup3;&#8310;)</p>
            <p className="text-lg font-bold text-accent-primary">
              {oracle.priceFloat.toFixed(6)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase font-mono">Scale Factor</p>
            <p className="text-sm text-text-primary font-mono break-all">
              {oracle.scaleFactor.toString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase font-mono">Address</p>
            <a
              href={`${chainConfig?.blockExplorer}/address/${oracle.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-info hover:text-info/80 font-mono"
            >
              {truncateAddress(oracle.address)}
            </a>
          </div>
        </div>
      </Card>

      {/* Feeds */}
      <Card>
        <CardHeader>
          <CardTitle>Chainlink Feeds</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3">
          <FeedCard label="BASE_FEED_1" address={oracle.baseFeed1} feed={oracle.baseFeed1Info} chainId={oracle.chainId} />
          <FeedCard label="BASE_FEED_2" address={oracle.baseFeed2} feed={oracle.baseFeed2Info} chainId={oracle.chainId} />
          <FeedCard label="QUOTE_FEED_1" address={oracle.quoteFeed1} feed={oracle.quoteFeed1Info} chainId={oracle.chainId} />
          <FeedCard label="QUOTE_FEED_2" address={oracle.quoteFeed2} feed={oracle.quoteFeed2Info} chainId={oracle.chainId} />
        </div>
      </Card>

      {/* Vaults */}
      {(oracle.baseVaultInfo || oracle.quoteVaultInfo) && (
        <Card>
          <CardHeader>
            <CardTitle>ERC-4626 Vaults</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3">
            {oracle.baseVaultInfo && (
              <VaultCard label="BASE_VAULT" vault={oracle.baseVaultInfo} sample={oracle.baseVaultConversionSample} chainId={oracle.chainId} />
            )}
            {oracle.quoteVaultInfo && (
              <VaultCard label="QUOTE_VAULT" vault={oracle.quoteVaultInfo} sample={oracle.quoteVaultConversionSample} chainId={oracle.chainId} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export function OracleDecoderPage() {
  const [chainId, setChainId] = useState(1);
  const [addressInput, setAddressInput] = useState('');
  const [oracle, setOracle] = useState<DecodedOracle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDecode = async () => {
    if (!isAddress(addressInput)) { setError('Invalid address'); return; }
    setLoading(true); setError(null); setOracle(null);
    try {
      const result = await decodeOracle(chainId, addressInput as Address);
      setOracle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to decode oracle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-text-primary">Oracle Decoder</h1>
        <p className="text-sm text-text-tertiary mt-0.5">
          Decode a deployed MorphoChainlinkOracleV2 — inspect feeds, vaults, scale factor, and live price
        </p>
      </div>

      {/* Input Card */}
      <Card>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 font-mono">
              // Chain
            </label>
            <select
              value={chainId}
              onChange={e => setChainId(Number(e.target.value))}
              className="w-full bg-bg-elevated border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus"
            >
              {getSupportedChainIds().map(id => (
                <option key={id} value={id}>{getChainConfig(id)?.name ?? id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 font-mono">
              // Oracle Address
            </label>
            <input
              type="text"
              value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              placeholder="0x..."
              className="w-full bg-bg-elevated border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button onClick={handleDecode} loading={loading} disabled={!addressInput}>
            Decode Oracle
          </Button>
        </div>
      </Card>

      {/* Results */}
      {oracle && <OracleResults oracle={oracle} />}
    </div>
  );
}
