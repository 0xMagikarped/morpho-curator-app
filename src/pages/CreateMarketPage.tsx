import { useState } from 'react';
import { MarketForm, type MarketFormData } from '../components/market/MarketForm';
import { MarketPreview } from '../components/market/MarketPreview';
import { MarketDeployer } from '../components/market/MarketDeployer';
import { computeMarketId } from '../lib/market/createMarket';

type Step = 'form' | 'preview' | 'deploy';

export function CreateMarketPage() {
  const [step, setStep] = useState<Step>('form');
  const [formData, setFormData] = useState<MarketFormData | null>(null);

  const handleFormSubmit = (data: MarketFormData) => {
    setFormData(data);
    setStep('preview');
  };

  const marketId = formData ? computeMarketId(formData) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Create Market</h1>
        <p className="text-sm text-text-tertiary mt-0.5">
          Deploy a new Morpho Blue market on-chain
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
      {step === 'deploy' && formData && marketId && (
        <MarketDeployer
          data={formData}
          marketId={marketId}
          onBack={() => setStep('preview')}
        />
      )}
    </div>
  );
}
