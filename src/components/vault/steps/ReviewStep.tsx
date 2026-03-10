import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { getChainConfig } from '../../../config/chains';
import { truncateAddress, formatWadPercent } from '../../../lib/utils/format';
import { formatTimelockDuration } from '../../../lib/vault/createVault';
import type { WizardState } from '../CreateVaultWizard';

interface ReviewStepProps {
  state: WizardState;
  onNext: () => void;
  onBack: () => void;
}

export function ReviewStep({ state, onNext, onBack }: ReviewStepProps) {
  const chainConfig = state.chainId ? getChainConfig(state.chainId) : null;
  const isV2 = state.version === 'v2';
  const factoryAddr = isV2 ? chainConfig?.vaultFactories.v2 : chainConfig?.vaultFactories.v1;

  const curator =
    state.curatorMode === 'owner'
      ? state.owner
      : state.curatorMode === 'custom'
        ? state.curatorAddress
        : null;
  const feeRecipient =
    state.feeRecipientMode === 'owner' ? state.owner : state.feeRecipientAddress;
  const guardian = state.guardianMode === 'custom' ? state.guardianAddress : null;

  const isZeroThenIncrease = state.timelockStrategy === 'zero-then-increase';

  // Count post-deploy transactions
  let txCount = 0;
  if (curator) txCount++;
  txCount += state.allocators.length;
  if (state.feePercent > 0) txCount++;
  if (feeRecipient) txCount++;

  if (isV2) {
    txCount += state.sentinels.length;
    if (state.managementFeePercent > 0) txCount += 2; // fee + recipient
    txCount += state.v2Timelocks.filter((t) => t.seconds > 0).length;
  } else {
    if (guardian) txCount++;
    txCount += state.selectedMarkets.length;
    if (state.selectedMarkets.length > 0) txCount += 2;
    if (isZeroThenIncrease && state.finalTimelockSeconds > 0) txCount++;
  }

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Review Configuration</CardTitle>
        <Badge variant={isV2 ? 'info' : 'success'}>{isV2 ? 'V2' : 'V1'}</Badge>
      </CardHeader>

      <div className="space-y-3 text-sm">
        <Row label="Chain" value={`${chainConfig?.name} (${state.chainId})`} />
        <Row label="Version" value={isV2 ? 'MetaMorpho V2' : 'MetaMorpho V1'} />
        <Row
          label="Factory"
          value={factoryAddr ? `${truncateAddress(factoryAddr)}` : 'N/A'}
          mono
        />
        <Row
          label="Asset"
          value={`${state.assetSymbol} (${state.asset ? truncateAddress(state.asset) : ''})`}
        />
        <Row label="Name" value={state.vaultName} />
        <Row label="Symbol" value={state.vaultSymbol} />
        <Row label="Owner" value={state.owner ? truncateAddress(state.owner) : 'N/A'} mono />
        {!isV2 && (
          <Row
            label="Initial Timelock"
            value={formatTimelockDuration(state.initialTimelockSeconds)}
          />
        )}
      </div>

      {/* Post-deploy config */}
      <div>
        <h3 className="text-xs text-text-tertiary mb-2">Post-Deploy Configuration:</h3>
        <div className="space-y-1 text-xs pl-3 border-l border-border-default">
          {curator && (
            <div className="text-text-primary">
              Set curator: <span className="font-mono text-text-secondary">{truncateAddress(curator)}</span>
            </div>
          )}
          {state.allocators.map((a) => (
            <div key={a} className="text-text-primary">
              Set allocator: <span className="font-mono text-text-secondary">{truncateAddress(a)}</span>
            </div>
          ))}

          {/* V2-specific */}
          {isV2 && state.sentinels.map((s) => (
            <div key={s} className="text-text-primary">
              Set sentinel: <span className="font-mono text-text-secondary">{truncateAddress(s)}</span>
            </div>
          ))}

          {state.feePercent > 0 && (
            <div className="text-text-primary">
              Set {isV2 ? 'performance ' : ''}fee: {state.feePercent}%
            </div>
          )}
          {feeRecipient && (
            <div className="text-text-primary">
              Set {isV2 ? 'performance ' : ''}fee recipient: <span className="font-mono text-text-secondary">{truncateAddress(feeRecipient)}</span>
            </div>
          )}

          {isV2 && state.managementFeePercent > 0 && (
            <>
              <div className="text-text-primary">
                Set management fee: {state.managementFeePercent}%
              </div>
              <div className="text-text-primary">
                Set management fee recipient: <span className="font-mono text-text-secondary">
                  {state.managementFeeRecipientMode === 'owner'
                    ? truncateAddress(state.owner ?? '0x')
                    : truncateAddress(state.managementFeeRecipientAddress ?? '0x')}
                </span>
              </div>
            </>
          )}

          {/* V1-specific */}
          {!isV2 && guardian && (
            <div className="text-text-primary">
              Set guardian: <span className="font-mono text-text-secondary">{truncateAddress(guardian)}</span>
            </div>
          )}
          {!isV2 && state.selectedMarkets.map((m, i) => (
            <div key={i} className="text-text-primary">
              Submit cap: {m.collateralSymbol}/{state.assetSymbol}{' '}
              <Badge>{formatWadPercent(BigInt(m.lltv))}</Badge>{' '}
              {m.supplyCap ? `${m.supplyCap} ${state.assetSymbol}` : 'unlimited'}
            </div>
          ))}
          {!isV2 && state.selectedMarkets.length > 0 && (
            <>
              <div className="text-text-primary">Set supply queue</div>
              <div className="text-text-primary">Set withdraw queue</div>
            </>
          )}
          {!isV2 && isZeroThenIncrease && state.finalTimelockSeconds > 0 && (
            <div className="text-text-primary">
              Increase timelock: 0 → {formatTimelockDuration(state.finalTimelockSeconds)}
            </div>
          )}

          {/* V2 timelocks */}
          {isV2 && state.v2Timelocks.filter((t) => t.seconds > 0).map((t) => (
            <div key={t.selector} className="text-text-primary">
              Set timelock: <span className="font-mono text-text-secondary">{t.label}</span> = {formatTimelockDuration(t.seconds)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span>Transactions: 1 deploy + {txCount} config</span>
      </div>

      {!isV2 && (
        <div className="bg-warning/10 p-3 text-xs text-warning/80">
          The oracle address for each market is IMMUTABLE. Verify oracle risk before deploying.
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Deploy</Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-text-tertiary text-xs">{label}</span>
      <span className={`text-text-primary text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
