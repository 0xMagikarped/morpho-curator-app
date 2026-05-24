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
import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData, isAddress } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { useV2TimelockedOp } from '../../../lib/hooks/useV2TimelockedOp';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';

/**
 * One variant per V2 setter we expose. The shape carries the user-facing
 * input + the encoded target calldata once committed.
 */
export type V2SetterIntent =
  | { kind: 'setCurator'; current: Address }
  | { kind: 'setPerformanceFee'; currentWad: bigint }
  | { kind: 'setPerformanceFeeRecipient'; current: Address }
  | { kind: 'setManagementFee'; currentWad: bigint }
  | { kind: 'setManagementFeeRecipient'; current: Address }
  | { kind: 'setName'; current: string }
  | { kind: 'setSymbol'; current: string }
  | { kind: 'setIsAllocator'; defaultAddress?: Address; defaultGrant?: boolean }
  | { kind: 'setIsSentinel'; defaultAddress?: Address; defaultGrant?: boolean };

interface V2SetterDrawerProps {
  open: boolean;
  onClose: () => void;
  intent: V2SetterIntent;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const;

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
    if (intent.kind === 'setIsAllocator' || intent.kind === 'setIsSentinel') {
      return intent.defaultAddress ?? '';
    }
    return '';
  });
  const [feeInput, setFeeInput] = useState<string>(() => {
    if (intent.kind === 'setPerformanceFee' || intent.kind === 'setManagementFee') {
      return (Number(intent.currentWad) / 1e16).toString(); // WAD → %
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

  const { writeContract, data: txHash, isPending, error, simulateError } = useGuardedWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || isConfirming;

  // Encode the target calldata from the current input.
  const calldata = useMemo<`0x${string}` | undefined>(() => {
    switch (intent.kind) {
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
    }
  }, [intent, addressInput, feeInput, textInput, grant]);

  const timelock = useV2TimelockedOp({
    vaultAddress,
    chainId,
    calldata,
    enabled: open && !!calldata,
  });

  const handleSubmit = () => {
    if (!calldata) return;
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
    // Execute by calling the target function directly with the same args
    // we used to build `calldata`. The V2 vault self-checks executableAt.
    switch (intent.kind) {
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
    }
  };

  const timelockDays = Number(timelockSeconds) / 86400;
  const title = labelForIntent(intent);

  return (
    <Drawer open={open} onClose={onClose} title={title}>
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

        {/* Timelock state banner */}
        {timelock.step === 'pending' && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary">
            <strong>Submitted to timelock.</strong> Executable at{' '}
            <span className="font-mono">{new Date(Number(timelock.executableAt) * 1000).toUTCString()}</span>.
          </div>
        )}
        {timelock.step === 'executable' && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-text-primary">
            <strong>Ready to execute.</strong> Click <span className="font-mono">Execute</span>.
          </div>
        )}

        {/* Action button — single button that swaps label by timelock state */}
        {!calldata ? (
          <Button className="w-full" disabled>
            {invalidHint(intent, addressInput, feeInput, textInput)}
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
          Timelocked change ({timelockDays.toFixed(1)}d). Submit queues the change; Execute applies
          it once the timelock has elapsed. On a 0-timelock vault both can be sent back-to-back.
        </div>
      </div>
    </Drawer>
  );
}

function CurrentValueRow({ intent }: { intent: V2SetterIntent }) {
  switch (intent.kind) {
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

function FeeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-text-tertiary block mb-1">{label}</label>
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
      />
      <p className="text-[10px] text-text-tertiary mt-1">Stored as WAD on-chain (100% = 1e18).</p>
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
    case 'setCurator': return 'Set Curator';
    case 'setPerformanceFee': return 'Set Performance Fee';
    case 'setPerformanceFeeRecipient': return 'Set Performance Fee Recipient';
    case 'setManagementFee': return 'Set Management Fee';
    case 'setManagementFeeRecipient': return 'Set Management Fee Recipient';
    case 'setName': return 'Set Vault Name';
    case 'setSymbol': return 'Set Vault Symbol';
    case 'setIsAllocator': return 'Manage Allocator';
    case 'setIsSentinel': return 'Manage Sentinel';
  }
}

function invalidHint(intent: V2SetterIntent, addr: string, fee: string, text: string): string {
  switch (intent.kind) {
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
  }
}
