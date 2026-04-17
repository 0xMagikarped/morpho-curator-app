/**
 * Renders a decoded TimeLock proposal body — header with target+function,
 * per-arg formatting via hints, meta line, and batch enumeration.
 *
 * Designed to live inside `PendingProposalsPanel`'s row. Falls back to a
 * "couldn't decode" block with the raw calldata when the decoder returns
 * null.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react';
import type { Address } from 'viem';
import { decodeCall, type DecodedArg, type DecodedCall } from '../../../lib/timelock/decodeCall';
import { getArgHint, resolveAddressLabel } from '../../../lib/timelock/hints';
import { getChainConfig } from '../../../config/chains';
import { useVaultSnapshot } from '../../../lib/vault/adapter';

interface ProposalContentsProps {
  chainId: number;
  /** The proposal's target address (the contract the call goes to). */
  target: Address;
  value: bigint;
  data: `0x${string}`;
  /**
   * Optional vault address for the surrounding UI. Used to pick up the
   * vault's asset decimals for amount formatting on submitCap / setFee.
   */
  vaultAddress?: Address;
}

export function ProposalContents({ chainId, target, value, data, vaultAddress }: ProposalContentsProps) {
  const { data: snapshot } = useVaultSnapshot(chainId, vaultAddress);
  const decoded = useMemo(() => decodeCall(target, value, data, chainId), [target, value, data, chainId]);

  if (!decoded) {
    return <UnknownCall target={target} data={data} chainId={chainId} />;
  }

  const assetDecimals = snapshot?.decimals;
  const assetSymbol = snapshot?.symbol;

  return (
    <DecodedBlock
      call={decoded}
      chainId={chainId}
      vaultAssetDecimals={assetDecimals}
      vaultAssetSymbol={assetSymbol}
      snapshotAddress={snapshot?.address ?? vaultAddress}
    />
  );
}

function DecodedBlock({
  call,
  chainId,
  vaultAssetDecimals,
  vaultAssetSymbol,
  snapshotAddress,
  depth = 0,
}: {
  call: DecodedCall;
  chainId: number;
  vaultAssetDecimals?: number;
  vaultAssetSymbol?: string;
  snapshotAddress?: Address;
  depth?: number;
}) {
  return (
    <div className={depth > 0 ? 'border-l border-border-subtle pl-2 ml-1' : ''}>
      <div className="text-[11px] flex flex-wrap items-baseline gap-1">
        <span className="font-mono text-accent-primary">{call.functionName}</span>
        <span className="text-text-tertiary">on</span>
        <TargetLabel target={call.target} chainId={chainId} fallbackAbiLabel={call.abiLabel} />
      </div>
      {call.args.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[10px]">
          {call.args.map((arg, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-text-tertiary font-mono shrink-0">{arg.name}:</span>
              <ArgValue
                arg={arg}
                functionName={call.functionName}
                allArgs={call.args}
                chainId={chainId}
                target={call.target}
                snapshotAddress={snapshotAddress}
                vaultAssetDecimals={vaultAssetDecimals}
                vaultAssetSymbol={vaultAssetSymbol}
              />
            </li>
          ))}
        </ul>
      )}

      {call.batch && call.batch.length > 0 && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-text-tertiary uppercase tracking-wider">
            Batch contents ({call.batch.length})
          </p>
          {call.batch.map((inner, i) => (
            <div key={i} className="bg-bg-surface/40 p-2">
              <div className="text-[9px] text-text-tertiary mb-1 font-mono">#{i + 1}</div>
              <DecodedBlock
                call={inner}
                chainId={chainId}
                vaultAssetDecimals={vaultAssetDecimals}
                vaultAssetSymbol={vaultAssetSymbol}
                snapshotAddress={snapshotAddress}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TargetLabel({
  target,
  chainId,
  fallbackAbiLabel,
}: {
  target: Address;
  chainId: number;
  fallbackAbiLabel: string;
}) {
  const hint = resolveAddressLabel(target, chainId);
  const display = hint.label ?? fallbackAbiLabel;
  return (
    <a
      href={hint.explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary"
    >
      <span>{display}</span>
      <span className="font-mono text-text-tertiary">
        {target.slice(0, 6)}…{target.slice(-4)}
      </span>
      <ExternalLink size={8} className="text-text-tertiary" />
    </a>
  );
}

function ArgValue({
  arg,
  functionName,
  allArgs,
  chainId,
  target,
  snapshotAddress,
  vaultAssetDecimals,
  vaultAssetSymbol,
}: {
  arg: DecodedArg;
  functionName: string;
  allArgs: readonly DecodedArg[];
  chainId: number;
  target: Address;
  snapshotAddress?: Address;
  vaultAssetDecimals?: number;
  vaultAssetSymbol?: string;
}) {
  const hint = getArgHint(functionName, arg.name, allArgs, {
    chainId,
    target,
    snapshotAddress,
    vaultAssetDecimals,
    vaultAssetSymbol,
  });

  // Address
  if (arg.type === 'address' && typeof arg.value === 'string') {
    const addrHint = resolveAddressLabel(arg.value as Address, chainId);
    return (
      <a
        href={addrHint.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-text-primary hover:underline inline-flex items-center gap-1"
      >
        {addrHint.label && <span className="text-accent-primary">{addrHint.label}</span>}
        <span className="text-text-tertiary">
          {(arg.value as string).slice(0, 6)}…{(arg.value as string).slice(-4)}
        </span>
      </a>
    );
  }

  // Amount with hint
  if (hint?.amount && typeof arg.value === 'bigint') {
    return <AmountValue raw={arg.value} decimals={hint.amount.decimals} symbol={hint.amount.symbol} />;
  }

  // Percent (WAD) — must check BEFORE the regex fallback because arg
  // names like "newFee" match /fee/i and would hit "decimals unknown".
  if (hint?.kind === 'percentWad' && typeof arg.value === 'bigint') {
    return <span className="font-mono text-text-primary">{(Number(arg.value) / 1e16).toFixed(2)}%</span>;
  }

  // Delay seconds — also before the regex fallback.
  if (hint?.kind === 'delaySeconds' && typeof arg.value === 'bigint') {
    return (
      <span className="font-mono text-text-primary">
        {humanizeSeconds(arg.value)}
        <span className="text-text-tertiary ml-1">({arg.value.toString()}s)</span>
      </span>
    );
  }

  // Token amount without hint — show raw + uncertainty marker
  if (
    typeof arg.value === 'bigint' &&
    (arg.type === 'uint256' || arg.type.startsWith('uint')) &&
    /cap|amount|assets|fee/i.test(arg.name)
  ) {
    return (
      <span className="font-mono text-text-primary inline-flex items-center gap-1">
        {formatBigInt(arg.value)}
        <span className="text-warning text-[9px]" title="Decimals unknown — value shown raw">
          (decimals unknown)
        </span>
      </span>
    );
  }

  // Market ID (bytes32)
  if (arg.type === 'bytes32' && typeof arg.value === 'string') {
    const v = arg.value as string;
    return (
      <span className="font-mono text-text-primary">
        {v.slice(0, 10)}…{v.slice(-8)}
        {hint?.kind === 'marketId' && (
          <span className="text-text-tertiary ml-1">(market ID)</span>
        )}
      </span>
    );
  }

  // Tuple — expand inline (MarketParams is the most common case)
  if (arg.type === 'tuple' && typeof arg.value === 'object' && arg.value) {
    return <TupleValue value={arg.value as Record<string, unknown>} chainId={chainId} />;
  }

  // bool / other primitives
  if (typeof arg.value === 'boolean') {
    return <span className="font-mono text-text-primary">{String(arg.value)}</span>;
  }
  if (typeof arg.value === 'bigint') {
    return <span className="font-mono text-text-primary">{arg.value.toString()}</span>;
  }
  if (typeof arg.value === 'string') {
    return (
      <span className="font-mono text-text-primary break-all">
        {arg.value.length > 64 ? `${arg.value.slice(0, 60)}…` : arg.value}
      </span>
    );
  }
  return <span className="font-mono text-text-tertiary">{String(arg.value)}</span>;
}

function AmountValue({
  raw,
  decimals,
  symbol,
}: {
  raw: bigint;
  decimals: number;
  symbol?: string;
}) {
  const whole = raw / 10n ** BigInt(decimals);
  const frac = raw % 10n ** BigInt(decimals);
  const fracStr = frac > 0n
    ? (Number(frac) / 10 ** decimals).toFixed(Math.min(4, decimals)).slice(2)
    : '';
  const display = `${whole.toLocaleString('en-US')}${fracStr ? `.${fracStr}` : ''}`;
  return (
    <span className="font-mono text-text-primary">
      {display}
      {symbol && <span className="text-text-tertiary ml-1">{symbol}</span>}
    </span>
  );
}

function TupleValue({
  value,
  chainId,
}: {
  value: Record<string, unknown>;
  chainId: number;
}) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-text-tertiary">()</span>;
  return (
    <span className="inline-flex flex-col gap-0.5">
      {entries.map(([k, v], i) => {
        // Render each field compactly, re-using the address path for 0x….
        if (typeof v === 'string' && v.startsWith('0x') && v.length === 42) {
          const hint = resolveAddressLabel(v as Address, chainId);
          return (
            <span key={i} className="font-mono text-[10px] text-text-primary">
              <span className="text-text-tertiary">{k}:</span>{' '}
              {hint.label && <span className="text-accent-primary">{hint.label} </span>}
              <span className="text-text-tertiary">{(v as string).slice(0, 6)}…{(v as string).slice(-4)}</span>
            </span>
          );
        }
        if (typeof v === 'bigint') {
          return (
            <span key={i} className="font-mono text-[10px] text-text-primary">
              <span className="text-text-tertiary">{k}:</span>{' '}
              {/lltv/i.test(k)
                ? `${(Number(v) / 1e16).toFixed(2)}%`
                : formatBigInt(v)}
            </span>
          );
        }
        return (
          <span key={i} className="font-mono text-[10px] text-text-primary">
            <span className="text-text-tertiary">{k}:</span> {String(v)}
          </span>
        );
      })}
    </span>
  );
}

function UnknownCall({ target, data, chainId }: { target: Address; data: `0x${string}`; chainId: number }) {
  const [open, setOpen] = useState(false);
  const selector = data.slice(0, 10);
  const config = getChainConfig(chainId);
  return (
    <div className="text-[11px] space-y-1.5">
      <div className="flex items-center gap-1.5 text-warning">
        <AlertTriangle size={11} />
        <span>Unable to fully decode. Verify manually on BscScan before executing.</span>
      </div>
      <div className="text-[10px] text-text-tertiary flex items-center gap-1">
        <span>Selector:</span>
        <span className="font-mono text-text-primary">{selector}</span>
        <span>·</span>
        <span>Target:</span>
        <a
          href={`${config?.blockExplorer}/address/${target}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-text-primary hover:underline"
        >
          {target.slice(0, 6)}…{target.slice(-4)}
        </a>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] text-text-tertiary hover:text-text-primary inline-flex items-center gap-0.5"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Raw calldata
      </button>
      {open && (
        <pre className="text-[9px] font-mono text-text-tertiary break-all whitespace-pre-wrap bg-bg-hover p-2">
          {data}
        </pre>
      )}
    </div>
  );
}

function formatBigInt(v: bigint): string {
  const s = v.toString();
  if (s.length <= 6) return s;
  // Add thousands separators, but keep it compact.
  return v.toLocaleString('en-US');
}

function humanizeSeconds(v: bigint): string {
  const s = Number(v);
  if (s % 86400 === 0) return `${s / 86400} day(s)`;
  if (s % 3600 === 0) return `${s / 3600} hour(s)`;
  if (s % 60 === 0) return `${s / 60} min(s)`;
  return `${s}s`;
}
