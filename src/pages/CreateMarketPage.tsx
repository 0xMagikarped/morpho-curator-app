import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MarketForm, type MarketFormData } from '../components/market/MarketForm';
import { MarketPreview } from '../components/market/MarketPreview';
import { MarketDeployer } from '../components/market/MarketDeployer';
import { MarketSeeder } from '../components/market/MarketSeeder';
import { SeedExistingMarketForm } from '../components/market/SeedExistingMarketForm';
import { computeMarketId } from '../lib/market/createMarket';

type Step = 'form' | 'preview' | 'deploy' | 'seed';
type Mode = 'create' | 'seed-existing';

export function CreateMarketPage() {
  const [searchParams] = useSearchParams();

  const seedMarketId = searchParams.get('seed') as `0x${string}` | null;

  const [mode] = useState<Mode>(seedMarketId ? 'seed-existing' : 'create');
  const [step, setStep] = useState<Step>(seedMarketId ? 'seed' : 'form');
  const [formData, setFormData] = useState<MarketFormData | null>(null);
  const [resolvedMarketId, setResolvedMarketId] = useState<`0x${string}` | null>(seedMarketId);

  const handleFormSubmit = (data: MarketFormData) => {
    setFormData(data);
    setStep('preview');
  };

  const handleSeedExistingResolved = (data: MarketFormData, marketId: `0x${string}`) => {
    setFormData(data);
    setResolvedMarketId(marketId);
    setStep('seed');
  };

  // Fixed-term markets: the ID is minted by the factory at deploy time
  const marketId =
    resolvedMarketId ??
    (formData && formData.rateModel !== 'fixed'
      ? computeMarketId(formData)
      : ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`));

  // Seed-existing mode: show the resolution form or go straight to seeder
  if (mode === 'seed-existing' && !formData) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Seed Market</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            Seed an existing Morpho Blue market at target utilization
          </p>
        </div>
        <SeedExistingMarketForm onResolved={handleSeedExistingResolved} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">
          {step === 'seed' ? 'Seed Market' : 'Create Market'}
        </h1>
        <p className="text-sm text-text-tertiary mt-0.5">
          {step === 'seed'
            ? 'Supply liquidity and borrow at target utilization'
            : 'Deploy a new Morpho Blue market on-chain'}
        </p>
      </div>

      {step === 'form' && <MarketForm onSubmit={handleFormSubmit} />}
      {step === 'preview' && formData && (
        <MarketPreview
          data={formData}
          onBack={() => setStep('form')}
          onDeploy={() => setStep('deploy')}
        />
      )}
      {step === 'deploy' && formData && (
        <MarketDeployer
          data={formData}
          marketId={marketId}
          onBack={() => setStep('preview')}
          onSeed={() => {
            // Compute the real market ID after deploy if it was zero
            if (formData.rateModel !== 'fixed') {
              setResolvedMarketId(computeMarketId(formData));
            }
            setStep('seed');
          }}
        />
      )}
      {step === 'seed' && formData && (
        <MarketSeeder
          data={formData}
          marketId={marketId}
          onBack={() => setStep(mode === 'seed-existing' ? 'form' : 'deploy')}
        />
      )}
    </div>
  );
}
