import { useEffect, useState } from 'react';
import { exportBackup, importBackup, requestPersistence } from '../lib/db';
import { navigate } from '../router';
import { getEngineDepth, getEngineLines, setEngineDepth, setEngineLines } from '../lib/prefs';
import { getAutoLink, getBoldNotation, getLichessEnabled, getToken, setAutoLink, setBoldNotation, setLichessEnabled, setToken as storeToken } from '../lib/prefs';

export function Settings() {
  const [token, setToken] = useState(getToken() ?? '');
  const [persisted, setPersisted] = useState<boolean>();
  const [msg, setMsg] = useState<string>();
  const [autoLink, setAuto] = useState(getAutoLink());
  const [bold, setBold] = useState(getBoldNotation());
  const [lichessOn, setLichessOn] = useState(getLichessEnabled());
  const [depth, setDepth] = useState(getEngineDepth());
  const [lines, setLines] = useState(getEngineLines());

  useEffect(() => {
    void requestPersistence().then(setPersisted);
  }, []);

  const saveToken = (v: string) => {
    setToken(v);
    storeToken(v);
  };

  const doExport = async () => {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], `apiary-backup-${data.exportedAt.slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Apiary backup' });
        return;
      } catch {
        /* cancelled: fall through to download */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = await importBackup(JSON.parse(await f.text()));
      setMsg(`Restored ${n} hive${n === 1 ? '' : 's'}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not read that backup.');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <h1>Settings</h1>
        <span />
      </header>

      <section className="stack">
        <h2>Backup</h2>
        <p className="muted small">
          Your hives live on this device. Save a backup to Files or iCloud Drive now and then.
          {persisted === false && ' Storage is not yet marked as persistent; adding the app to your Home Screen fixes that.'}
        </p>
        <button type="button" className="primary wide" onClick={doExport}>Save a backup</button>
        <label className="file-drop compact">
          <input type="file" accept="application/json,.json" onChange={(e) => doImport(e.target.files?.[0])} />
          <span>Restore from a backup file</span>
        </label>
        {msg && <p className="small">{msg}</p>}
      </section>

      <section className="stack">
        <h2>Moves in your text</h2>
        <p className="muted small">
          Lines you wrap in angle brackets in a Lichess comment, like &lt;12...Bf6 13.Bxf6 Nxf5&gt;, become clickable.
          The brackets are hidden, and a bracketed line with an illegal move is underlined in red.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={autoLink} onChange={(e) => { setAuto(e.target.checked); setAutoLink(e.target.checked); }} />
          <span>Also make unbracketed moves clickable when they are legal</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={bold} onChange={(e) => { setBold(e.target.checked); setBoldNotation(e.target.checked); }} />
          <span>Show moves and squares in the text in bold (not clickable)</span>
        </label>
      </section>

      <section className="stack">
        <h2>Engine</h2>
        <p className="muted small">
          Tap <strong>SF</strong> in the reader to see Stockfish's evaluation. Stockfish 19 (lite network) runs on this
          phone, works offline and sends nothing anywhere. It stops when it reaches the depth below, when you switch it
          off, or when the app is in the background.
        </p>
        <div className="row">
          <label className="field">
            <span>Depth</span>
            <select value={depth} onChange={(e) => { setDepth(+e.target.value); setEngineDepth(+e.target.value); }}>
              {[12, 16, 20, 24, 28].map((d) => <option key={d} value={d}>{d}{d === 20 ? ' (default)' : ''}</option>)}
              <option value={0}>No limit (uses more battery)</option>
            </select>
          </label>
          <label className="field">
            <span>Lines shown</span>
            <select value={lines} onChange={(e) => { setLines(+e.target.value); setEngineLines(+e.target.value); }}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="stack">
        <h2>Lichess</h2>
        <label className="toggle">
          <input type="checkbox" checked={lichessOn} onChange={(e) => { setLichessOn(e.target.checked); setLichessEnabled(e.target.checked); }} />
          <span>Allow downloading studies from lichess.org</span>
        </label>
        <p className="muted small">
          This is the only thing the app ever connects to, and only when you tap Get study or Sync.
          Switch it off and the app makes no network requests at all; you can still upload or paste PGN.
        </p>
        <label className="field">
          <span>Personal token (only for private studies)</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="lip_…" />
        </label>
        <p className="muted small">Unlisted and public studies don't need this.</p>
      </section>
    </div>
  );
}
