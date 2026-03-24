import { useState, useMemo } from 'react';
import { formatEther, parseEther, formatUnits, parseUnits, isAddress } from 'viem';
import type { Address } from 'viem';
import { ChevronDown, ChevronRight, Zap, Shield, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { AddressDisplay } from '../ui/AddressDisplay';
import {
  usePublicAllocatorConfig,
  usePublicAllocatorActions,
  MAX_SETTABLE_FLOW_CAP,
  type FlowCapConfig,
} from '../../lib/hooks/usePublicAllocator';
import { formatTokenAmount } from '../../lib/utils/format';

interface PublicAllocatorPanelProps {
  chainId: number;
  vaultAddress: Address;
  isOwner: boolean;
  isCurator: boolean;
  assetSymbol: string;
  assetDecimals: number;
  markets: Array<{
    marketId: `0x${string}`;
    label: string;
    currentSupply: bigint;
  }>;
}

export function PublicAllocatorPanel({
  chainId,
  vaultAddress,
  isOwner,
  isCurator,
  assetSymbol,
  assetDecimals,
  markets,
}: PublicAllocatorPanelProps) {
  const { data: paConfig, isLoading, refetch } = usePublicAllocatorConfig(chainId, vaultAddress, markets);
  const actions = usePublicAllocatorActions(chainId, vaultAddress);

  const [expanded, setExpanded] = useState(false);
  const [editingCaps, setEditingCaps] = useState<Record<string, { maxIn: string; maxOut: string }>>({});
  const [feeInput, setFeeInput] = useState('');
  const [adminInput, setAdminInput] = useState('');
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [showFeeForm, setShowFeeForm] = useState(false);

  const isEditing = Object.keys(editingCaps).length > 0;
  const canConfigure = isOwner || isCurator;
  const ZERO = '0x0000000000000000000000000000000000000000';

  // Determine if PA admin matches connected wallet (admin can also configure)
  const isAdmin = paConfig?.admin && paConfig.admin !== ZERO;

  const hasChangedCaps = useMemo(() => {
    if (!paConfig || !isEditing) return false;
    return Object.entries(editingCaps).some(([marketId, edited]) => {
      const existing = paConfig.flowCaps.find((fc) => fc.marketId === marketId);
      if (!existing) return true;
      const existingIn = formatUnits(existing.maxIn, assetDecimals);
      const existingOut = formatUnits(existing.maxOut, assetDecimals);
      return edited.maxIn !== existingIn || edited.maxOut !== existingOut;
    });
  }, [editingCaps, paConfig, assetDecimals, isEditing]);

  if (isLoading) {
    return <div className="h-12 animate-shimmer bg-bg-hover" />;
  }

  // PA not available on this chain
  if (!paConfig || !paConfig.paAddress) {
    return null; // Silent — don't show the panel if PA is not deployed
  }

  const handleApplyFlowCaps = () => {
    const configs: FlowCapConfig[] = Object.entries(editingCaps).map(([marketId, caps]) => ({
      marketId: marketId as `0x${string}`,
      caps: {
        maxIn: parseUnits(caps.maxIn || '0', assetDecimals),
        maxOut: parseUnits(caps.maxOut || '0', assetDecimals),
      },
    }));

    // Validate: none exceed MAX_SETTABLE_FLOW_CAP
    for (const c of configs) {
      if (c.caps.maxIn > MAX_SETTABLE_FLOW_CAP || c.caps.maxOut > MAX_SETTABLE_FLOW_CAP) {
        return; // Silently reject — UI should prevent this
      }
    }

    actions.setFlowCaps(configs);
    setEditingCaps({});
    setTimeout(() => refetch(), 3000);
  };

  const setAllCaps = (maxIn: string, maxOut: string) => {
    const caps: Record<string, { maxIn: string; maxOut: string }> = {};
    for (const fc of paConfig.flowCaps) {
      caps[fc.marketId] = { maxIn, maxOut };
    }
    setEditingCaps(caps);
  };

  const startEditCap = (marketId: string, currentMaxIn: bigint, currentMaxOut: bigint) => {
    setEditingCaps((prev) => ({
      ...prev,
      [marketId]: {
        maxIn: formatUnits(currentMaxIn, assetDecimals),
        maxOut: formatUnits(currentMaxOut, assetDecimals),
      },
    }));
  };

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
          aria-label={expanded ? 'Collapse Public Allocator' : 'Expand Public Allocator'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-info" />
            <CardTitle>Public Allocator</CardTitle>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {paConfig.isEnabled ? (
            <Badge variant="success">Enabled</Badge>
          ) : (
            <Badge>Disabled</Badge>
          )}
          {canConfigure && (
            <Button
              size="sm"
              variant={paConfig.isEnabled ? 'ghost' : 'primary'}
              onClick={() => {
                if (paConfig.isEnabled) {
                  actions.disablePA();
                } else {
                  actions.enablePA();
                }
                setTimeout(() => refetch(), 3000);
              }}
              loading={actions.isPending || actions.isConfirming}
              disabled={!isOwner}
            >
              {paConfig.isEnabled ? 'Disable' : 'Enable PA'}
            </Button>
          )}
        </div>
      </CardHeader>

      {!isOwner && !paConfig.isEnabled && (
        <p className="text-text-tertiary text-xs px-1">
          Only the vault owner can enable the Public Allocator.
        </p>
      )}

      {expanded && (
        <div className="space-y-4 mt-2">
          {/* TX Success/Error */}
          {actions.isSuccess && (
            <div className="bg-success/10 border border-success/20 px-3 py-1.5 text-xs text-success">
              Transaction confirmed. Refreshing...
            </div>
          )}

          {/* Status & Config */}
          {paConfig.isEnabled && (
            <>
              {/* Admin & Fee Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-text-tertiary uppercase">Admin</span>
                  <div className="mt-0.5">
                    {paConfig.admin === ZERO ? (
                      <span className="text-text-tertiary">None (owner only)</span>
                    ) : (
                      <AddressDisplay address={paConfig.admin} chainId={chainId} />
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-text-tertiary uppercase">Fee per Reallocation</span>
                  <p className="font-mono text-text-primary mt-0.5">
                    {paConfig.fee === 0n ? '0' : formatEther(paConfig.fee)} ETH
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-text-tertiary uppercase">Accrued Fees</span>
                  <p className="font-mono text-text-primary mt-0.5">
                    {paConfig.accruedFee === 0n ? '0' : formatEther(paConfig.accruedFee)} ETH
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-text-tertiary uppercase">PA Contract</span>
                  <div className="mt-0.5">
                    <AddressDisplay address={paConfig.paAddress!} chainId={chainId} />
                  </div>
                </div>
              </div>

              {/* Admin/Fee Actions */}
              {canConfigure && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowAdminForm(!showAdminForm)}>
                    Set Admin
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowFeeForm(!showFeeForm)}>
                    Set Fee
                  </Button>
                  {paConfig.accruedFee > 0n && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        actions.transferFee();
                        setTimeout(() => refetch(), 3000);
                      }}
                      loading={actions.isPending || actions.isConfirming}
                    >
                      Withdraw Fees
                    </Button>
                  )}
                </div>
              )}

              {/* Admin Form */}
              {showAdminForm && canConfigure && (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="New admin address (0x...)"
                    value={adminInput}
                    onChange={(e) => setAdminInput(e.target.value)}
                    className="flex-1 bg-bg-hover border border-border-default px-2 py-1 text-sm font-mono text-text-primary"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (isAddress(adminInput)) {
                        actions.setAdmin(adminInput as Address);
                        setAdminInput('');
                        setShowAdminForm(false);
                        setTimeout(() => refetch(), 3000);
                      }
                    }}
                    disabled={!isAddress(adminInput) || actions.isPending}
                    loading={actions.isPending || actions.isConfirming}
                  >
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAdminForm(false); setAdminInput(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Fee Form */}
              {showFeeForm && canConfigure && (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Fee in ETH (e.g. 0.001)"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    className="w-40 bg-bg-hover border border-border-default px-2 py-1 text-sm font-mono text-text-primary"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      try {
                        const fee = parseEther(feeInput || '0');
                        actions.setFee(fee);
                        setFeeInput('');
                        setShowFeeForm(false);
                        setTimeout(() => refetch(), 3000);
                      } catch { /* invalid input */ }
                    }}
                    disabled={!feeInput || actions.isPending}
                    loading={actions.isPending || actions.isConfirming}
                  >
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowFeeForm(false); setFeeInput(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Flow Caps Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-tertiary uppercase tracking-wider">
                    Flow Caps ({assetSymbol})
                  </span>
                  {canConfigure && !isEditing && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        // Start editing all markets with their current values
                        const caps: Record<string, { maxIn: string; maxOut: string }> = {};
                        for (const fc of paConfig.flowCaps) {
                          caps[fc.marketId] = {
                            maxIn: formatUnits(fc.maxIn, assetDecimals),
                            maxOut: formatUnits(fc.maxOut, assetDecimals),
                          };
                        }
                        setEditingCaps(caps);
                      }}
                    >
                      Edit Flow Caps
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                        <th className="text-left py-2">Market</th>
                        <th className="text-right py-2">Max In</th>
                        <th className="text-right py-2">Max Out</th>
                        <th className="text-right py-2">Supply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paConfig.flowCaps.map((fc) => {
                        const editing = editingCaps[fc.marketId];
                        const isZeroCaps = fc.maxIn === 0n && fc.maxOut === 0n;

                        return (
                          <tr key={fc.marketId} className="border-b border-border-subtle/50">
                            <td className="py-2 text-text-primary">{fc.label}</td>
                            <td className="text-right py-2">
                              {editing ? (
                                <input
                                  type="text"
                                  value={editing.maxIn}
                                  onChange={(e) =>
                                    setEditingCaps((prev) => ({
                                      ...prev,
                                      [fc.marketId]: { ...prev[fc.marketId]!, maxIn: e.target.value },
                                    }))
                                  }
                                  className="w-28 bg-bg-hover border border-border-default px-2 py-1 text-right text-sm font-mono text-text-primary"
                                />
                              ) : (
                                <span className={`font-mono ${isZeroCaps ? 'text-text-tertiary' : 'text-text-primary'}`}>
                                  {fc.maxIn === 0n ? '0' : formatTokenAmount(fc.maxIn, assetDecimals)}
                                </span>
                              )}
                            </td>
                            <td className="text-right py-2">
                              {editing ? (
                                <input
                                  type="text"
                                  value={editing.maxOut}
                                  onChange={(e) =>
                                    setEditingCaps((prev) => ({
                                      ...prev,
                                      [fc.marketId]: { ...prev[fc.marketId]!, maxOut: e.target.value },
                                    }))
                                  }
                                  className="w-28 bg-bg-hover border border-border-default px-2 py-1 text-right text-sm font-mono text-text-primary"
                                />
                              ) : (
                                <span className={`font-mono ${isZeroCaps ? 'text-text-tertiary' : 'text-text-primary'}`}>
                                  {fc.maxOut === 0n ? '0' : formatTokenAmount(fc.maxOut, assetDecimals)}
                                </span>
                              )}
                            </td>
                            <td className="text-right py-2 font-mono text-text-secondary text-xs">
                              {formatTokenAmount(fc.currentSupply, assetDecimals)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Quick-set & Apply */}
                {isEditing && canConfigure && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] text-text-tertiary uppercase self-center mr-1">Quick Set:</span>
                      <Button size="sm" variant="ghost" onClick={() => setAllCaps('1000000', '1000000')}>
                        1M Equal
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAllCaps('5000000', '5000000')}>
                        5M Equal
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAllCaps('0', '0')}>
                        Reset to 0
                      </Button>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditingCaps({})}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApplyFlowCaps}
                        disabled={!hasChangedCaps || actions.isPending || actions.isConfirming}
                        loading={actions.isPending || actions.isConfirming}
                      >
                        Apply Flow Caps ({Object.keys(editingCaps).length} markets)
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Dynamic caps explanation */}
              <div className="flex items-start gap-2 px-2 py-1.5 bg-bg-hover/50 text-[10px] text-text-tertiary">
                <Shield size={12} className="shrink-0 mt-0.5" />
                <span>
                  Flow caps adjust dynamically: when funds flow out of a market, its maxOut decreases and maxIn increases (and vice versa).
                  Reset caps via <span className="font-mono">setFlowCaps</span> to restore original limits.
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
