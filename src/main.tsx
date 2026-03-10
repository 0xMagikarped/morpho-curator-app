import './lib/morpho/augment'; // Morpho SDK augmentation — must be first
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const root = document.getElementById('root')!;

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  console.error('Failed to render app:', err);
  root.innerHTML = `<div style="color:white;padding:2rem;font-family:monospace"><h1>App failed to load</h1><pre>${String(err)}</pre></div>`;
}
