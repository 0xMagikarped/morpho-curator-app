import { useQuery } from '@tanstack/react-query';
import { keccak256, toHex, type Address } from 'viem';
import { AlertOctagon, CheckCircle2, DollarSign, Layers, Shield, ArrowRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { AddressDisplay } from '../ui/AddressDisplay';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../../lib/data/rpcClient';
import { moolahSingletonAbi } from '../../lib/contracts/moolahAbis';
import { useMoolahSingletonState } from '../../lib/hooks/useMoolahSingleton';

interface ProtocolTabProps {
  chainId: number;
}

// Pre-computed role constants keyed by Moolah's convention
// (bare `keccak256(bytes("ROLE_NAME"))`, not the OZ v4 `keccak256("ROLE_NAME_ROLE")`).
const MOOLAH_ROLES = {
  DEFAULT_ADMIN: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
  MANAGER: keccak256(toHex('MANAGER')),
  PAUSER: keccak256(toHex('PAUSER')),
} as const;

/**
 * Protocol tab — read-only snapshot of the Moolah singleton and its
 * liquidator/revenue stack. Rendered only when the chain's `protocol`
 * field is `'moolah'`.
 *
 * Everything here is sourced from:
 *   - live reads of the Moolah singleton (`useMoolahSingletonState`)
 *   - live role enumeration on the singleton
 *   - static addresses from `chainConfig.moolah` (`docs/bnb-lista-inventory.md`)
 */
export function ProtocolTab({ chainId }: ProtocolTabProps) {
  return (
    <div className="space-y-4">
      <ProtocolStateCard chainId={chainId} />
      <RevenueFlowDiagram chainId={chainId} />
      <RestrictedListsCard chainId={chainId} />
      <GovernanceCard chainId={chainId} />
    </div>
  );
}

// ------------------------------------------------------------
// ProtocolStateCard: pause status, minLoanValue, defaultMarketFee, impl
// ------------------------------------------------------------

function ProtocolStateCard({ chainId }: { chainId: number }) {
  const { data: state, isLoading } = useMoolahSingletonState(chainId);
  const config = getChainConfig(chainId);
  const singleton = config?.morphoBlue;

  // Implementation slot lives on the singleton — it's a UUPS proxy on Moolah.
  const { data: implementation } = useQuery({
    queryKey: ['moolah-singleton-impl', chainId, singleton],
    queryFn: async (): Promise<Address | null> => {
      if (!chainId || !singleton) return null;
      const client = getPublicClient(chainId);
      try {
        const slot =
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
        const raw = await client.getStorageAt({ address: singleton, slot });
        if (!raw || raw === `0x${'0'.repeat(64)}`) return null;
        return `0x${raw.slice(-40)}` as Address;
      } catch {
        return null;
      }
    },
    enabled: Boolean(singleton),
    staleTime: 10 * 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            Protocol state
            <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
              Moolah · Lista
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      {isLoading || !state ? (
        <div className="h-20 animate-shimmer bg-bg-hover" />
      ) : (
        <div className="space-y-2 text-[11px]">
          <Row
            icon={state.isPaused ? <AlertOctagon size={12} className="text-danger" /> : <CheckCircle2 size={12} className="text-success" />}
            label="Pause status"
          >
            <span className={state.isPaused ? 'text-danger' : 'text-success'}>
              {state.isPaused ? 'PAUSED — writes revert' : 'Active'}
            </span>
          </Row>

          <Row icon={<DollarSign size={12} className="text-text-tertiary" />} label="Min loan value">
            {state.minLoanValue > 0n ? (
              <>
                <span className="font-mono text-text-primary">
                  ${(Number(state.minLoanValue) / 1e8).toFixed(2)}
                </span>
                <span className="text-text-tertiary ml-1">(8dp oracle, anti-dust floor)</span>
              </>
            ) : (
              <span className="text-text-tertiary">Not set</span>
            )}
          </Row>

          <Row icon={<Layers size={12} className="text-text-tertiary" />} label="Default market fee">
            {state.defaultMarketFee > 0n ? (
              <>
                <span className="font-mono text-text-primary">
                  {(Number(state.defaultMarketFee) / 1e16).toFixed(2)}%
                </span>
                <span className="text-text-tertiary ml-1">(WAD)</span>
              </>
            ) : (
              <span className="text-text-tertiary">Not set</span>
            )}
          </Row>

          {singleton && (
            <Row label="Singleton proxy">
              <AddressDisplay address={singleton} chainId={chainId} />
            </Row>
          )}

          {implementation && (
            <Row label="Singleton implementation">
              <AddressDisplay address={implementation} chainId={chainId} />
            </Row>
          )}

          {config?.moolah?.vaultImpl && (
            <Row label="Vault implementation">
              <AddressDisplay address={config.moolah.vaultImpl} chainId={chainId} />
              <span className="text-text-tertiary ml-1">(shared by all MoolahVault proxies)</span>
            </Row>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------
// RevenueFlowDiagram: Liquidator → RevenueDistributor → BuyBack / AutoBuyBack → LISTA
// ------------------------------------------------------------

function RevenueFlowDiagram({ chainId }: { chainId: number }) {
  const config = getChainConfig(chainId);
  const moolah = config?.moolah;
  if (!moolah) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue flow</CardTitle>
      </CardHeader>
      <div className="space-y-3 text-[11px]">
        <p className="text-text-tertiary">
          Liquidation fees and market fees are routed through Lista's revenue
          pipeline. End destination: LISTA token buybacks.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <FlowNode label="Liquidator" address={moolah.liquidators.liquidator} chainId={chainId} />
          <Arrow />
          <FlowNode
            label="PublicLiquidator"
            address={moolah.liquidators.publicLiquidator}
            chainId={chainId}
          />
          <Arrow />
          <FlowNode
            label="RevenueDistributor"
            address={moolah.revenue.revenueDistributor}
            chainId={chainId}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-4 md:pl-0">
          <span className="text-text-tertiary text-[10px] md:ml-[calc(2*8rem)]">↳</span>
          <FlowNode label="BuyBack" address={moolah.revenue.buyback} chainId={chainId} />
          <span className="text-text-tertiary">+</span>
          <FlowNode label="AutoBuyBack" address={moolah.revenue.autoBuyback} chainId={chainId} />
          <Arrow />
          <span className="px-2 py-1 text-[11px] font-mono bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
            LISTA
          </span>
        </div>

        {moolah.liquidators.brokerLiquidator && (
          <div className="pt-2 border-t border-border-subtle">
            <p className="text-text-tertiary text-[10px] mb-1">Fixed-term markets route through:</p>
            <FlowNode label="BrokerLiquidator" address={moolah.liquidators.brokerLiquidator} chainId={chainId} />
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// RestrictedListsCard — vault blacklist + flashloan token blacklist
// ------------------------------------------------------------

function RestrictedListsCard({ chainId }: { chainId: number }) {
  const config = getChainConfig(chainId);
  const singleton = config?.morphoBlue;

  // Probing `vaultBlacklist(addr)` and `flashLoanTokenBlacklist(addr)`
  // would require a set of candidate addresses. We don't have a
  // membership enumeration on-chain, so we surface known candidates from
  // tracked vaults + chain stablecoins and show their status. Empty rows
  // ("not blacklisted") are collapsed.
  const knownVaults = Object.keys(config?.knownVaults ?? {}) as Address[];
  const tokens = (config?.stablecoins ?? []).map((t) => t.address);
  const wrapped = config?.nativeToken.wrapped;
  if (wrapped) tokens.push(wrapped);

  const { data: results } = useQuery({
    queryKey: ['moolah-restricted-lists', chainId, knownVaults.length, tokens.length],
    queryFn: async () => {
      if (!singleton) return { vaults: [], tokens: [] };
      const client = getPublicClient(chainId);

      const [vaultResults, tokenResults] = await Promise.all([
        Promise.all(
          knownVaults.map((addr) =>
            client
              .readContract({
                address: singleton,
                abi: moolahSingletonAbi,
                functionName: 'vaultBlacklist',
                args: [addr],
              })
              .then((v) => ({ addr, blacklisted: Boolean(v) }))
              .catch(() => ({ addr, blacklisted: false })),
          ),
        ),
        Promise.all(
          tokens.map((addr) =>
            client
              .readContract({
                address: singleton,
                abi: moolahSingletonAbi,
                functionName: 'flashLoanTokenBlacklist',
                args: [addr],
              })
              .then((v) => ({ addr, blacklisted: Boolean(v) }))
              .catch(() => ({ addr, blacklisted: false })),
          ),
        ),
      ]);

      return {
        vaults: vaultResults.filter((r) => r.blacklisted),
        tokens: tokenResults.filter((r) => r.blacklisted),
      };
    },
    enabled: Boolean(singleton),
    staleTime: 5 * 60_000,
  });

  const hasAnything = (results?.vaults.length ?? 0) > 0 || (results?.tokens.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Restricted lists</CardTitle>
      </CardHeader>
      <div className="space-y-3 text-[11px]">
        {results && results.vaults.length > 0 && (
          <div>
            <p className="text-text-tertiary mb-1 uppercase tracking-wider text-[10px]">
              Vault blacklist ({results.vaults.length})
            </p>
            <ul className="space-y-1">
              {results.vaults.map((r) => (
                <li key={r.addr}>
                  <AddressDisplay address={r.addr} chainId={chainId} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {results && results.tokens.length > 0 && (
          <div>
            <p className="text-text-tertiary mb-1 uppercase tracking-wider text-[10px]">
              Flashloan token blacklist ({results.tokens.length})
            </p>
            <ul className="space-y-1">
              {results.tokens.map((r) => (
                <li key={r.addr}>
                  <AddressDisplay address={r.addr} chainId={chainId} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {!hasAnything && (
          <p className="text-text-secondary">
            No known vaults or tokens are on Lista's restricted lists today.
          </p>
        )}
        <p className="text-[10px] text-text-tertiary">
          Only known candidates are probed. The singleton doesn't expose
          membership enumeration, so additional addresses may be restricted
          without this UI knowing.
        </p>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// GovernanceCard — singleton role holders
// ------------------------------------------------------------

function GovernanceCard({ chainId }: { chainId: number }) {
  const config = getChainConfig(chainId);
  const singleton = config?.morphoBlue;
  const moolah = config?.moolah;

  // Live probe: check whether each hinted role holder still holds the role.
  const { data: checks } = useQuery({
    queryKey: ['moolah-singleton-roles', chainId, singleton],
    queryFn: async () => {
      if (!singleton || !moolah) return null;
      const client = getPublicClient(chainId);
      const probe = async (role: `0x${string}`, account: Address) => {
        try {
          const result = await client.readContract({
            address: singleton,
            abi: [
              {
                inputs: [
                  { name: 'role', type: 'bytes32' },
                  { name: 'account', type: 'address' },
                ],
                name: 'hasRole',
                outputs: [{ type: 'bool' }],
                stateMutability: 'view',
                type: 'function',
              },
            ] as const,
            functionName: 'hasRole',
            args: [role, account],
          });
          return Boolean(result);
        } catch {
          return false;
        }
      };

      const [adminOk, operatorOk, pauserOk] = await Promise.all([
        probe(MOOLAH_ROLES.DEFAULT_ADMIN, moolah.vaultAdmin),
        probe(MOOLAH_ROLES.MANAGER, moolah.roles.operator),
        probe(MOOLAH_ROLES.PAUSER, moolah.roles.pauser),
      ]);
      return { adminOk, operatorOk, pauserOk };
    },
    enabled: Boolean(singleton && moolah),
    staleTime: 10 * 60_000,
  });

  if (!moolah) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <Shield size={12} />
            Governance
          </span>
        </CardTitle>
      </CardHeader>
      <div className="space-y-2 text-[11px]">
        <Row label="DEFAULT_ADMIN_ROLE">
          <AddressDisplay address={moolah.vaultAdmin} chainId={chainId} />
          <RoleStatus ok={checks?.adminOk} />
          <span className="text-text-tertiary ml-1">(Lista DAO Safe — upgrades impl)</span>
        </Row>
        <Row label="MANAGER">
          <AddressDisplay address={moolah.roles.operator} chainId={chainId} />
          <RoleStatus ok={checks?.operatorOk} />
          <span className="text-text-tertiary ml-1">(operator — calls MarketFactory)</span>
        </Row>
        <Row label="PAUSER">
          <AddressDisplay address={moolah.roles.pauser} chainId={chainId} />
          <RoleStatus ok={checks?.pauserOk} />
          <span className="text-text-tertiary ml-1">(pauses the protocol)</span>
        </Row>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Shared building blocks
// ------------------------------------------------------------

function Row({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="mt-0.5">{icon}</span>}
      <span className="text-text-tertiary min-w-[9rem] text-[11px]">{label}:</span>
      <span className="flex items-center gap-1 flex-wrap">{children}</span>
    </div>
  );
}

function FlowNode({
  label,
  address,
  chainId,
}: {
  label: string;
  address: Address;
  chainId: number;
}) {
  const config = getChainConfig(chainId);
  return (
    <a
      href={`${config?.blockExplorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex flex-col items-start gap-0 px-2 py-1 bg-bg-hover border border-border-subtle hover:border-accent-primary text-[11px] transition-colors"
    >
      <span className="text-text-primary font-medium flex items-center gap-1">
        {label} <ExternalLink size={9} className="text-text-tertiary" />
      </span>
      <span className="text-text-tertiary font-mono text-[9px]">
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
    </a>
  );
}

function Arrow() {
  return <ArrowRight size={12} className="text-text-tertiary shrink-0" />;
}

function RoleStatus({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return ok ? (
    <CheckCircle2 size={10} className="text-success" aria-label="Role confirmed on-chain" />
  ) : (
    <AlertOctagon size={10} className="text-warning" aria-label="Role not confirmed — hinted address may be stale" />
  );
}
