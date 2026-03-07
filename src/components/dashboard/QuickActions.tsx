import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';

interface QuickActionsProps {
  onTrackVault: () => void;
}

export function QuickActions({ onTrackVault }: QuickActionsProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate('/create')}>
          + Create Vault
        </Button>
        <Button size="sm" variant="secondary" onClick={() => navigate('/markets')}>
          Scan Markets
        </Button>
        <Button size="sm" variant="secondary" onClick={onTrackVault}>
          + Track Vault
        </Button>
      </div>
    </Card>
  );
}
