import { useState } from 'react';
import type { Address } from 'viem';
import { isAddress, encodeFunctionData } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { useAdapterPreview } from '../../../lib/hooks/useV2Adapters';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';

interface AddAdapterDrawerProps {
  open: boolean;
  onClose: () => void;
  chainId: number;
  vaultAddress: Address;
  vaultAsset: Address;
  timelockSeconds: bigint;
}

export function AddAdapterDrawer({
  open,
  onClose,
  chainId,
  vaultAddress,
  vaultAsset,
  timelockSeconds,
}: AddAdapterDrawerProps) {
  const [adapterInput, setAdapterInput] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const adapterAddress = isAddress(adapterInput) ? adapterInput : undefined;
  const {
    data: preview,
    isLoading: previewLoading,
    error: previewError,
  } = useAdapterPreview(chainId, vaultAddress, adapterAddress, vaultAsset, showPreview && !!adapterAddress);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handlePreview = () => {
    if (!adapterAddress) return;
    setShowPreview(true);
  };

  const handleSubmit = () => {
    if (!adapterAddress) return;
    // Encode addAdapter(address) call and wrap in submit()
    const innerData = encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: 'addAdapter',
      args: [adapterAddress],
    });

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'submit',
      args: [innerData],
    });
  };

  const handleClose = () => {
    setAdapterInput('');
    setShowPreview(false);
    onClose();
  };

  const timelockDays = Number(timelockSeconds) / 86400;
  const canSubmit = preview && preview.contractExists && !preview.isAlreadyEnabled && preview.assetMatch !== false;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Add Adapter to Vault"
      subtitle={`Chain ${chainId}`}
      footer={
        showPreview && preview && !isSuccess ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Submit — Add Adapter
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {isSuccess ? (
          <div className="text-center py-8">
            <Badge variant="success" className="mb-2">Submitted</Badge>
            <p className="text-sm text-text-primary">Adapter addition submitted to timelock.</p>
            <p className="text-xs text-text-tertiary mt-1">
              Executable in {timelockDays.toFixed(1)} days.
            </p>
          </div>
        ) : !showPreview ? (
          /* Step 1: Input */
          <>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">Adapter Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={adapterInput}
                onChange={(e) => setAdapterInput(e.target.value)}
                className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
              />
            </div>
            <Button
              onClick={handlePreview}
              disabled={!adapterAddress}
              className="w-full"
            >
              Preview Adapter
            </Button>
          </>
        ) : (
          /* Step 2: Preview */
          <>
            {previewLoading && (
              <div className="space-y-2">
                <div className="h-4 animate-shimmer bg-bg-hover" />
                <div className="h-4 animate-shimmer bg-bg-hover w-3/4" />
                <div className="h-4 animate-shimmer bg-bg-hover w-1/2" />
              </div>
            )}

            {previewError && (
              <div className="text-danger text-sm">
                Failed to preview adapter: {previewError instanceof Error ? previewError.message : 'Unknown error'}
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-text-primary uppercase tracking-wider">
                  <span className="font-mono">{'//'}</span> Adapter Preview
                </h3>

                {/* Validation checks */}
                <div className="space-y-1.5">
                  <CheckRow
                    pass={preview.contractExists}
                    label="Contract exists"
                    detail={preview.contractExists ? 'Bytecode found' : 'No contract at this address'}
                  />
                  <CheckRow
                    pass={!preview.isAlreadyEnabled}
                    label="Not already enabled"
                    detail={preview.isAlreadyEnabled ? 'Adapter is already enabled on this vault' : 'Ready to add'}
                  />
                  <CheckRow
                    pass={preview.assetMatch === true}
                    label="Asset compatibility"
                    detail={
                      preview.assetMatch === true
                        ? 'Asset matches vault'
                        : preview.assetMatch === false
                          ? 'Asset mismatch — adapter uses a different asset'
                          : 'Could not verify asset'
                    }
                    warn={preview.assetMatch === null}
                  />
                </div>

                {/* Type info */}
                <div className="border-t border-border-subtle pt-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-text-tertiary">Type</span>
                      <p className="text-text-primary mt-0.5">
                        {preview.detection.type === 'vault-v1' && 'MorphoVaultV1Adapter'}
                        {preview.detection.type === 'market-v1' && 'MorphoMarketV1AdapterV2'}
                        {preview.detection.type === 'unknown' && 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Address</span>
                      <div className="mt-0.5">
                        <AddressDisplay address={adapterInput} chainId={chainId} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* V1 Vault target details */}
                {preview.detection.type === 'vault-v1' && preview.detection.targetVault && (
                  <div className="border-t border-border-subtle pt-3">
                    <h4 className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2">
                      Target V1 Vault
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-text-tertiary">Name</span>
                        <p className="text-text-primary mt-0.5">
                          {preview.detection.targetVaultName ?? 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Address</span>
                        <div className="mt-0.5">
                          <AddressDisplay address={preview.detection.targetVault} chainId={chainId} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Market adapter details */}
                {preview.detection.type === 'market-v1' && preview.detection.morphoBlue && (
                  <div className="border-t border-border-subtle pt-3">
                    <h4 className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2">
                      Target: Morpho Blue Markets
                    </h4>
                    <div className="text-xs">
                      <span className="text-text-tertiary">Morpho Blue:</span>
                      <div className="mt-0.5">
                        <AddressDisplay address={preview.detection.morphoBlue} chainId={chainId} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Risk summary */}
                <div className="border-t border-border-subtle pt-3">
                  <h4 className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2">
                    Risk Summary
                  </h4>
                  <ul className="space-y-1 text-xs text-text-secondary">
                    {preview.detection.type === 'vault-v1' && (
                      <>
                        <li>Funds go to V1 vault, then to Morpho Blue markets</li>
                        <li>Double fee layer (V2 fees + V1 fees)</li>
                        <li>Withdrawal speed depends on V1 vault liquidity</li>
                      </>
                    )}
                    {preview.detection.type === 'market-v1' && (
                      <>
                        <li>Direct allocation to Morpho Blue V1 markets</li>
                        <li>Withdrawal depends on market liquidity</li>
                      </>
                    )}
                    {preview.detection.type === 'unknown' && (
                      <li className="text-warning">Unknown adapter type — proceed with caution</li>
                    )}
                  </ul>
                </div>

                {/* Timelock notice */}
                <div className="bg-bg-hover px-3 py-2 text-xs text-text-secondary">
                  This action requires a timelock of {timelockDays.toFixed(1)} days.
                </div>
              </div>
            )}

            {!previewLoading && !preview && (
              <Button variant="ghost" onClick={() => setShowPreview(false)}>
                Back
              </Button>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function CheckRow({
  pass,
  label,
  detail,
  warn,
}: {
  pass: boolean;
  label: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={pass ? 'text-success' : warn ? 'text-warning' : 'text-danger'}>
        {pass ? '\u2713' : warn ? '?' : '\u2717'}
      </span>
      <div>
        <span className="text-text-primary">{label}</span>
        <span className="text-text-tertiary ml-1">— {detail}</span>
      </div>
    </div>
  );
}
