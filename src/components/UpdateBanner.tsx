import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady } from '../lib/update';

export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => onUpdateReady(setReady), []);
  if (!ready || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Apiary is ready.</span>
      <button type="button" className="primary" onClick={() => void applyUpdate()}>Reload</button>
      <button type="button" className="icon-btn small-text" onClick={() => setHidden(true)} aria-label="Later">✕</button>
    </div>
  );
}
