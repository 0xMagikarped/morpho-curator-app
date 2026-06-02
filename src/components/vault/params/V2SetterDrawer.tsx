/**
 * PR 26 — generic V2 Submit→Wait→Execute drawer for single-call setters.
 *
 * Every V2 vault config change goes through the same 2-tx flow:
 *
 *   tx 1: vault.submit(targetCalldata)                       — queues
 *   …wait until executableAt(targetCalldata) ≤ now…           — 0s on most XDC vaults
 *   tx 2: vault.<targetFn>(args)                              — self-checks executableAt
 *
 * The drawer is parameterized by a `V2SetterIntent` discriminated union.
 * Each variant carries the input + encodes its own target calldata. The
 * `useV2TimelockedOp` read (PR 10) drives the Submit / Wait / Execute
 * button state; the simulation guard (PR 8) catches role-mismatched
 * calls before they reach the wallet.
 *
 * Doesn't reimplement any cap logic — separate from CapEditDrawer (PR
 * 22) which is cap-specific (abs + rel pair). This drawer takes ONE
 * input per setter and bakes Submit/Wait/Execute around it.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData, isAddress } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { useV2TimelockedOp } from '../../../lib/hooks/useV2TimelockedOp';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../../lib/queryKeys';

/**
 * PR 29 — `maxRate` is `interestRatePerSecond` in WAD. UI surfaces APR%
 * to match Morpho's curator app. Round-trip helpers:
 *
 *   wadPerSec ↔ aprPct   via   apr = ratePerSec * SECONDS_PER_YEAR
 */
const SECONDS_PER_YEAR = 365 * 24 * 3600 + Math.floor(24 * 3600 / 4); // 365.25d
const SECONDS_PER_YEAR_BI = BigInt(SECONDS_PER_YEAR);

function wadPerSecondToAprPct(wadPerSec: bigint): number {
  // apr [unitless] = ratePerSec * SECONDS_PER_YEAR
  // pct = apr * 100
  return (Number(wadPerSec) * SECONDS_PER_YEAR) / 1e16;
}
function aprPctToWadPerSecond(pct: number): bigint {
  if (!isFinite(pct) || pct < 0) return 0n;
  // wadPerSec = (pct / 100) * 1e18 / SECONDS_PER_YEAR
  // Keep precision by deferring the SECONDS_PER_YEAR divide until last.
  const apr1e16 = BigInt(Math.round(pct * 1e16)); // 100 * 1e16 = 1e18 = 100%
  return apr1e16 / SECONDS_PER_YEAR_BI;
}

/**
 * One variant per V2 setter we expose. The shape carries the user-facing
 * input + the encoded target calldata once committed.
 */
export type V2SetterIntent =
  | { kind: 'transferOwnership'; current: Address; pending?: Address }
  | { kind: 'setCurator'; current: Address }
  | { kind: 'setPerformanceFee'; currentWad: bigint }
  | { kind: 'setPerformanceFeeRecipient'; current: Address }
  | { kind: 'setManagementFee'; currentWad: bigint }
  | { kind: 'setManagementFeeRecipient'; current: Address }
  | { kind: 'setName'; current: string }
  | { kind: 'setSymbol'; current: string }
  | { kind: 'setIsAllocator'; defaultAddress?: Address; defaultGrant?: boolean }
  | { kind: 'setIsSentinel'; defaultAddress?: Address; defaultGrant?: boolean }
  // PR 28
  | { kind: 'setMaxRate'; currentWad: bigint }
  | { kind: 'setForceDeallocatePenalty'; adapter: Address; current: bigint };

interface V2SetterDrawerProps {
  open: boolean;
  onClose: () => void;
  intent: V2SetterIntent;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const;

/**
 * Owner-only setters on Vault V2 are NOT routed through `submit(bytes)`.
 * The wizard (`createVault.ts` "Owner-only functions (no timelock)") calls
 * them directly. Routing them through `submit` reverts with `NotAuthorized`
 * because `submit` is curator-gated — and on a fresh vault `curator()` is
 * `0x0`, so the owner can't even bootstrap themselves into the curator role.
 *
 * The user-visible symptom on Pharos: "Add Allocator does nothing" — actually
 * upstream of that, "Set Curator" silently failed for the same reason, so
 * the curator was still zero and nobody could submit anything.
 */
function isDirectSetter(intent: V2SetterIntent): boolean {
  switch (intent.kind) {
    case 'transferOwnership':
    case 'setCurator':
    case 'setName':
    case 'setSymbol':
    case 'setIsSentinel':
      return true;
    default:
      return false;
  }
}

export function V2SetterDrawer({
  open,
  onClose,
  intent,
  vaultAddress,
  chainId,
  timelockSeconds,
}: V2SetterDrawerProps) {
  // Per-intent input state. Kept local to this drawer instance so closing
  // and re-opening resets.
  const [addressInput, setAddressInput] = useState<string>(() => {
    if (intent.kind === 'setCurator' || intent.kind === 'setPerformanceFeeRecipient' || intent.kind === 'setManagementFeeRecipient') {
      return intent.current;
    }
    if (intent.kind === 'transferOwnership') {
      // Don't pre-fill the current owner — user must type the new one.
      return '';
    }
    if (intent.kind === 'setIsAllocator' || intent.kind === 'setIsSentinel') {
      return intent.defaultAddress ?? '';
    }
    return '';
  });
  const [feeInput, setFeeInput] = useState<string>(() => {
    if (intent.kind === 'setPerformanceFee' || intent.kind === 'setManagementFee') {
      return (Number(intent.currentWad) / 1e16).toString(); // WAD → %
    }
    if (intent.kind === 'setMaxRate') {
      // PR 29 — maxRate is stored as RATE-PER-SECOND in WAD; UI shows APR%.
      // 100% APR ≈ 3.17e10 WAD; user typing "50%" must compress that down
      // through the SECONDS_PER_YEAR divisor, else the contract rejects
      // with `MaxRateTooHigh` (the user-visible bug from PR 28).
      return wadPerSecondToAprPct(intent.currentWad).toFixed(2);
    }
    if (intent.kind === 'setForceDeallocatePenalty') {
      return (Number(intent.current) / 1e16).toString();
    }
    return '';
  });
  const [textInput, setTextInput] = useState<string>(() => {
    if (intent.kind === 'setName' || intent.kind === 'setSymbol') return intent.current;
    return '';
  });
  const [grant, setGrant] = useState<boolean>(() => {
    if (intent.kind === 'setIsAllocator' || intent.kind === 'setIsSentinel') {
      return intent.defaultGrant ?? true;
    }
    return true;
  });

  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending, error, simulateError, reset } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || isConfirming;

  // Track which of the two-step actions is in flight so we only treat the
  // EXECUTE confirmation as "done" — a Submit confirmation just queues the
  // timelocked op and must keep the drawer open for the Execute step.
  const [lastAction, setLastAction] = useState<'submit' | 'execute' | null>(null);
  const executed = isSuccess && lastAction === 'execute';

  const handleClose = useCallback(() => {
    reset();
    setLastAction(null);
    onClose();
  }, [reset, onClose]);

  // On a confirmed Execute: refresh the vault data (so the new value shows)
  // + the allocator list, then auto-close after a brief confirmation.
  useEffect(() => {
    if (!executed) return;
    void queryClient.invalidateQueries({ queryKey: vaultKeys.fullData(chainId, vaultAddress) });
    void queryClient.invalidateQueries({
      queryKey: [...vaultKeys.fullData(chainId, vaultAddress), 'allocators'],
    });
    const t = setTimeout(handleClose, 1500);
    return () => clearTimeout(t);
  }, [executed, queryClient, chainId, vaultAddress, handleClose]);

  // Encode the target calldata from the current input.
  const calldata = useMemo<`0x${string}` | undefined>(() => {
    switch (intent.kind) {
      case 'transferOwnership':
        if (!isAddress(addressInput)) return undefined;
        if (addressInput.toLowerCase() === intent.current.toLowerCase()) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'transferOwnership', args: [addressInput] });
      case 'setCurator':
        if (!isAddress(addressInput)) return undefined;
        if (addressInput.toLowerCase() === intent.current.toLowerCase()) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setCurator', args: [addressInput] });
      case 'setPerformanceFee': {
        const pct = parseFloat(feeInput);
        if (isNaN(pct) || pct < 0 || pct > 100) return undefined;
        const wad = BigInt(Math.floor(pct * 1e16));
        if (wad === intent.currentWad) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setPerformanceFee', args: [wad] });
      }
      case 'setPerformanceFeeRecipient':
        if (!isAddress(addressInput)) return undefined;
        if (addressInput.toLowerCase() === intent.current.toLowerCase()) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setPerformanceFeeRecipient', args: [addressInput] });
      case 'setManagementFee': {
        const pct = parseFloat(feeInput);
        if (isNaN(pct) || pct < 0 || pct > 100) return undefined;
        const wad = BigInt(Math.floor(pct * 1e16));
        if (wad === intent.currentWad) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setManagementFee', args: [wad] });
      }
      case 'setManagementFeeRecipient':
        if (!isAddress(addressInput)) return undefined;
        if (addressInput.toLowerCase() === intent.current.toLowerCase()) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setManagementFeeRecipient', args: [addressInput] });
      case 'setName':
        if (!textInput || textInput === intent.current) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setName', args: [textInput] });
      case 'setSymbol':
        if (!textInput || textInput === intent.current) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setSymbol', args: [textInput] });
      case 'setIsAllocator':
        if (!isAddress(addressInput)) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setIsAllocator', args: [addressInput, grant] });
      case 'setIsSentinel':
        if (!isAddress(addressInput)) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setIsSentinel', args: [addressInput, grant] });
      case 'setMaxRate': {
        const pct = parseFloat(feeInput);
        if (isNaN(pct) || pct < 0) return undefined;
        const wadPerSec = aprPctToWadPerSecond(pct);
        if (wadPerSec === intent.currentWad) return undefined;
        return encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'setMaxRate', args: [wadPerSec] });
      }
      case 'setForceDeallocatePenalty': {
        const pct = parseFloat(feeInput);
        if (isNaN(pct) || pct < 0 || pct > 100) return undefined;
        const wad = BigInt(Math.floor(pct * 1e16));
        if (wad === intent.current) return undefined;
        return encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'setForceDeallocatePenalty',
          args: [intent.adapter, wad],
        });
      }
    }
  }, [intent, addressInput, feeInput, textInput, grant]);

  const direct = isDirectSetter(intent);
  const timelock = useV2TimelockedOp({
    vaultAddress,
    chainId,
    calldata,
    enabled: open && !!calldata && !direct,
  });

  const handleSubmit = () => {
    if (!calldata) return;
    setLastAction('submit');
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'submit',
      args: [calldata],
      chainId,
    });
  };

  const handleExecute = () => {
    if (!calldata) return;
    setLastAction('execute');
    // Execute by calling the target function directly with the same args
    // we used to build `calldata`. The V2 vault self-checks executableAt.
    switch (intent.kind) {
      case 'transferOwnership':
        // Ownable2Step — only initiates the transfer; the new owner must
        // call `acceptOwnership()` to finish (surfaced inline on the
        // current-value row when applicable).
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'transferOwnership', args: [addressInput as Address], chainId });
      case 'setCurator':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setCurator', args: [addressInput as Address], chainId });
      case 'setPerformanceFee':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setPerformanceFee', args: [BigInt(Math.floor(parseFloat(feeInput) * 1e16))], chainId });
      case 'setPerformanceFeeRecipient':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setPerformanceFeeRecipient', args: [addressInput as Address], chainId });
      case 'setManagementFee':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setManagementFee', args: [BigInt(Math.floor(parseFloat(feeInput) * 1e16))], chainId });
      case 'setManagementFeeRecipient':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setManagementFeeRecipient', args: [addressInput as Address], chainId });
      case 'setName':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setName', args: [textInput], chainId });
      case 'setSymbol':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setSymbol', args: [textInput], chainId });
      case 'setIsAllocator':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setIsAllocator', args: [addressInput as Address, grant], chainId });
      case 'setIsSentinel':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setIsSentinel', args: [addressInput as Address, grant], chainId });
      case 'setMaxRate':
        return writeContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setMaxRate', args: [aprPctToWadPerSecond(parseFloat(feeInput))], chainId });
      case 'setForceDeallocatePenalty':
        return writeContract({
          address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'setForceDeallocatePenalty',
          args: [intent.adapter, BigInt(Math.floor(parseFloat(feeInput) * 1e16))], chainId,
        });
    }
  };

  const timelockDays = Number(timelockSeconds) / 86400;
  const title = labelForIntent(intent);

  if (executed) {
    return (
      <Drawer open={open} onClose={handleClose} title={title}>
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Done</Badge>
          <p className="text-sm text-text-primary">Change applied.</p>
          <p className="text-xs text-text-tertiary mt-1">The vault parameters have been updated.</p>
          <Button size="sm" variant="secondary" onClick={handleClose} className="mt-4">
            Back to vault
          </Button>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer open={open} onClose={handleClose} title={title}>
      <div className="space-y-4">
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}

        <CurrentValueRow intent={intent} />

        <IntentInput
          intent={intent}
          addressInput={addressInput}
          setAddressInput={setAddressInput}
          feeInput={feeInput}
          setFeeInput={setFeeInput}
          textInput={textInput}
          setTextInput={setTextInput}
          grant={grant}
          setGrant={setGrant}
        />

        {/* Timelock state banner — hidden for direct (owner-only) setters */}
        {!direct && timelock.step === 'pending' && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary">
            <strong>Submitted to timelock.</strong> Executable at{' '}
            <span className="font-mono">{new Date(Number(timelock.executableAt) * 1000).toUTCString()}</span>.
          </div>
        )}
        {!direct && timelock.step === 'executable' && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-text-primary">
            <strong>Ready to execute.</strong> Click <span className="font-mono">Execute</span>.
          </div>
        )}

        {/* Action button — direct setters get a single Save; timelocked setters swap label by state. */}
        {!calldata ? (
          <Button className="w-full" disabled>
            {invalidHint(intent, addressInput, feeInput, textInput)}
          </Button>
        ) : direct ? (
          <Button className="w-full" onClick={handleExecute} disabled={busy} loading={busy}>
            Save
          </Button>
        ) : timelock.step === 'loading' ? (
          <Button className="w-full" disabled>Checking timelock…</Button>
        ) : timelock.step === 'pending' ? (
          <Button className="w-full" disabled>Waiting for timelock…</Button>
        ) : timelock.step === 'executable' ? (
          <Button className="w-full" onClick={handleExecute} disabled={busy} loading={busy}>
            Execute
          </Button>
        ) : (
          <Button className="w-full" onClick={handleSubmit} disabled={busy} loading={busy}>
            Submit (Step 1/2)
          </Button>
        )}

        <div className="bg-bg-hover px-3 py-2 text-xs text-text-secondary">
          {direct
            ? 'Owner-only setter — applied in a single transaction (no timelock queue).'
            : `Timelocked change (${timelockDays.toFixed(1)}d). Submit queues the change; Execute applies it once the timelock has elapsed. On a 0-timelock vault both can be sent back-to-back.`}
        </div>
      </div>
    </Drawer>
  );
}

function CurrentValueRow({ intent }: { intent: V2SetterIntent }) {
  switch (intent.kind) {
    case 'transferOwnership':
      return (
        <div className="text-xs space-y-1">
          <div>
            <span className="text-text-tertiary">Current owner: </span>
            <span className="font-mono text-text-primary">
              {intent.current === ZERO_ADDR ? 'Not set' : intent.current}
            </span>
          </div>
          {intent.pending && intent.pending !== ZERO_ADDR && (
            <div>
              <span className="text-text-tertiary">Pending owner: </span>
              <span className="font-mono text-warning">{intent.pending}</span>{' '}
              <span className="text-[10px] text-text-tertiary">(awaiting acceptOwnership)</span>
            </div>
          )}
        </div>
      );
    case 'setCurator':
    case 'setPerformanceFeeRecipient':
    case 'setManagementFeeRecipient':
      return (
        <div className="text-xs">
          <span className="text-text-tertiary">Current: </span>
          <span className="font-mono text-text-primary">
            {intent.current === ZERO_ADDR ? 'Not set' : intent.current}
          </span>
        </div>
      );
    case 'setPerformanceFee':
    case 'setManagementFee':
      return (
        <div className="text-xs">
          <span className="text-text-tertiary">Current: </span>
          <span className="font-mono text-text-primary">{(Number(intent.currentWad) / 1e16).toFixed(2)}%</span>
        </div>
      );
    case 'setMaxRate':
      return (
        <div className="text-xs">
          <span className="text-text-tertiary">Current: </span>
          <span className="font-mono text-text-primary">
            {wadPerSecondToAprPct(intent.currentWad).toFixed(2)}% APR
          </span>
        </div>
      );
    case 'setForceDeallocatePenalty':
      return (
        <div className="text-xs space-y-1">
          <div>
            <span className="text-text-tertiary">Adapter: </span>
            <span className="font-mono text-text-primary">{intent.adapter.slice(0, 10)}…{intent.adapter.slice(-4)}</span>
          </div>
          <div>
            <span className="text-text-tertiary">Current: </span>
            <span className="font-mono text-text-primary">{(Number(intent.current) / 1e16).toFixed(2)}%</span>
          </div>
        </div>
      );
    case 'setName':
    case 'setSymbol':
      return (
        <div className="text-xs">
          <span className="text-text-tertiary">Current: </span>
          <span className="font-mono text-text-primary">{intent.current || '(unset)'}</span>
        </div>
      );
    case 'setIsAllocator':
    case 'setIsSentinel':
      // No single "current" — it's a per-address mapping. Skip.
      return null;
  }
}

function IntentInput({
  intent,
  addressInput,
  setAddressInput,
  feeInput,
  setFeeInput,
  textInput,
  setTextInput,
  grant,
  setGrant,
}: {
  intent: V2SetterIntent;
  addressInput: string;
  setAddressInput: (v: string) => void;
  feeInput: string;
  setFeeInput: (v: string) => void;
  textInput: string;
  setTextInput: (v: string) => void;
  grant: boolean;
  setGrant: (v: boolean) => void;
}) {
  switch (intent.kind) {
    case 'transferOwnership':
      return (
        <AddressField label="New Owner" value={addressInput} onChange={setAddressInput} />
      );
    case 'setCurator':
    case 'setPerformanceFeeRecipient':
    case 'setManagementFeeRecipient':
      return (
        <AddressField label="New Address" value={addressInput} onChange={setAddressInput} />
      );
    case 'setPerformanceFee':
    case 'setManagementFee':
      return (
        <FeeField label="New Fee (%)" value={feeInput} onChange={setFeeInput} />
      );
    case 'setMaxRate':
      return (
        <FeeField
          label="New Max Rate (% APR)"
          value={feeInput}
          onChange={setFeeInput}
          hint="On-chain stored as rate-per-second in WAD; converted from APR automatically."
        />
      );
    case 'setForceDeallocatePenalty':
      return (
        <FeeField label="New Penalty (%)" value={feeInput} onChange={setFeeInput} hint="Applied when allocators force-deallocate this adapter (WAD)." />
      );
    case 'setName':
    case 'setSymbol':
      return (
        <TextField label={intent.kind === 'setName' ? 'New Name' : 'New Symbol'} value={textInput} onChange={setTextInput} />
      );
    case 'setIsAllocator':
    case 'setIsSentinel':
      return (
        <>
          <AddressField label="Address" value={addressInput} onChange={setAddressInput} />
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Action</label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  checked={grant}
                  onChange={() => setGrant(true)}
                  className="accent-accent-primary"
                />
                Grant
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  checked={!grant}
                  onChange={() => setGrant(false)}
                  className="accent-accent-primary"
                />
                Revoke
              </label>
            </div>
          </div>
        </>
      );
  }
}

function AddressField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-text-tertiary block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x…"
        className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
      />
      {value.length > 0 && !isAddress(value) && (
        <p className="text-[10px] text-warning mt-1">Not a valid 20-byte address.</p>
      )}
    </div>
  );
}

function FeeField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-tertiary block mb-1">{label}</label>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
      />
      <p className="text-[10px] text-text-tertiary mt-1">{hint ?? 'Stored as WAD on-chain (100% = 1e18).'}</p>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-text-tertiary block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-border-focus focus:outline-none"
      />
    </div>
  );
}

function labelForIntent(intent: V2SetterIntent): string {
  switch (intent.kind) {
    case 'transferOwnership': return 'Transfer Ownership';
    case 'setCurator': return 'Set Curator';
    case 'setPerformanceFee': return 'Set Performance Fee';
    case 'setPerformanceFeeRecipient': return 'Set Performance Fee Recipient';
    case 'setManagementFee': return 'Set Management Fee';
    case 'setManagementFeeRecipient': return 'Set Management Fee Recipient';
    case 'setName': return 'Set Vault Name';
    case 'setSymbol': return 'Set Vault Symbol';
    case 'setIsAllocator': return 'Manage Allocator';
    case 'setIsSentinel': return 'Manage Sentinel';
    case 'setMaxRate': return 'Set Max Rate';
    case 'setForceDeallocatePenalty': return 'Set Force Deallocate Penalty';
  }
}

function invalidHint(intent: V2SetterIntent, addr: string, fee: string, text: string): string {
  switch (intent.kind) {
    case 'transferOwnership':
      if (!isAddress(addr)) return 'Enter a valid address';
      return 'Enter a different address';
    case 'setCurator':
    case 'setPerformanceFeeRecipient':
    case 'setManagementFeeRecipient':
      if (!isAddress(addr)) return 'Enter a valid address';
      return 'Enter a different address';
    case 'setPerformanceFee':
    case 'setManagementFee':
      if (!fee || isNaN(parseFloat(fee))) return 'Enter a fee %';
      return 'Enter a different fee';
    case 'setName':
    case 'setSymbol':
      if (!text) return 'Enter a value';
      return 'Enter a different value';
    case 'setIsAllocator':
    case 'setIsSentinel':
      return isAddress(addr) ? 'Pick an address' : 'Enter a valid address';
    case 'setMaxRate':
    case 'setForceDeallocatePenalty':
      if (!fee || isNaN(parseFloat(fee))) return 'Enter a rate %';
      return 'Enter a different rate';
  }
}
