import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTextPrefs, applyTheme } from './lib/prefs';
import { startUpdates } from './lib/update';
import { startScreenFit } from './lib/screenFit';

applyTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
applyTextPrefs();

startUpdates();
startScreenFit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
