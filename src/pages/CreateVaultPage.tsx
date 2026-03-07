import { CreateVaultWizard } from '../components/vault/CreateVaultWizard';

export function CreateVaultPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Create Vault</h1>
        <p className="text-sm text-text-tertiary mt-0.5">
          Deploy a new MetaMorpho V1 vault via the factory contract
        </p>
      </div>

      <CreateVaultWizard />
    </div>
  );
}
