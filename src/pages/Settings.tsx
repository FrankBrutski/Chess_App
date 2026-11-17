import { useEffect, useState } from 'react';
import { exportBackup, importBackup, requestPersistence } from '../lib/db';
import { navigate } from '../router';
import { getAutoLink, getBoldNotation, getLichessEnabled, getToken, setAutoLink, setBoldNotation, setLichessEnabled, setToken as storeToken } from '../lib/prefs';

export function Settings() {
  const [token, setToken] = useState(getToken() ?? '');
  const [persisted, setPersisted] = useState<boolean>();
  const [msg, setMsg] = useState<string>();
  const [autoLink, setAuto] = useState(getAutoLink());
  const [bold, setBold] = useState(getBoldNotation());
  const [lichessOn, setLichessOn] = useState(getLichessEnabled());

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
    const file = new File([blob], `chess-app-backup-${data.exportedAt.slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Chess App backup' });
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
      setMsg(`Restored ${n} courses.`);
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
          Your courses live on this device. Save a backup to Files or iCloud Drive now and then.
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
