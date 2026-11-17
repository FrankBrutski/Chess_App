import { useEffect, useState } from 'react';
import { exportBackup, importBackup, requestPersistence } from '../lib/db';
import { goBack } from '../router';
import { appVersion, buildTime, checkForUpdate } from '../lib/update';
import { getEngineDepth, getEngineLines, setEngineDepth, setEngineLines } from '../lib/prefs';
import {
  getHoneyLearn, getHoneyReview, getLadder, getMissPolicy, getRetryBack, getReviewNotes, getShowNewMoves, setHoneyLearn,
  setHoneyReview, setLadder, setMissPolicy, setRetryBack, setReviewNotes, setShowNewMoves,
} from '../lib/prefs';
import { getShowMarkers, setShowMarkers } from '../lib/prefs';
import { getTheme, setTheme, type Theme } from '../lib/prefs';
import { getLineOrder, setLineOrder, getTextPrefs, setTextPrefs, DEFAULT_TEXT, type TextPrefs } from '../lib/prefs';
import { CHESSABLE_LADDER, DEFAULT_LADDER, formatLadder, parseLadder, type MissPolicy } from '../lib/srs';
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
  const [ladderText, setLadderText] = useState(formatLadder(getLadder()));
  const [ladderMsg, setLadderMsg] = useState<string>();
  const [miss, setMiss] = useState(getMissPolicy());
  const [retry, setRetry] = useState(getRetryBack());
  const [reviewNotes, setRN] = useState(getReviewNotes());
  const [showNew, setSN] = useState(getShowNewMoves());
  const [hl, setHl] = useState(getHoneyLearn());
  const [order, setOrder] = useState(getLineOrder());
  const [markers, setMarkers] = useState(getShowMarkers());
  const [theme, setThemeState] = useState(getTheme());
  const [text, setText] = useState(getTextPrefs());
  const [updateMsg, setUpdateMsg] = useState<string>();
  const changeText = (patch: Partial<TextPrefs>) => { const t = { ...text, ...patch }; setText(t); setTextPrefs(t); };
  const [hr, setHr] = useState(getHoneyReview());
  const saveLadder = (text: string) => {
    setLadderText(text);
    try {
      const l = parseLadder(text);
      setLadder(formatLadder(l) === formatLadder(DEFAULT_LADDER) ? null : l);
      setLadderMsg(`Saved: ${l.length} steps.`);
    } catch (e) {
      setLadderMsg(e instanceof Error ? e.message : 'Check the steps.');
    }
  };

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
        <button type="button" className="icon-btn" onClick={() => goBack()} aria-label="Back">‹</button>
        <h1>Settings</h1>
        <span />
      </header>

      <h3 className="set-head">General</h3>
      <details className="set-group">
        <summary>
          <h2>Appearance</h2>
          <span className="muted small">Light, Dark or Auto</span>
        </summary>
        <div className="stack">
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? 'on' : undefined}
              onClick={() => { setThemeState(t); setTheme(t); }}
            >
              {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <p className="muted small">Auto follows your iPhone's Light/Dark setting.</p>
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Text</h2>
          <span className="muted small">Size, weight, spacing, font</span>
        </summary>
        <div className="stack">
        <div className="text-preview chapter-text" aria-label="Preview">
          <p className="line-main">
            <span className="mv mv-main"><span className="mv-num">12…</span>Nf6</span>{' '}
            <span className="mv mv-main"><span className="mv-num">13.</span>Bxf6</span>
          </p>
          <p className="comment">
            And we can consider 12...Nf6? but better is <span className="inline-move">12…Bf6 13.Bxf6 Nxf5</span>, when the
            e5 square is ours.
          </p>
        </div>
        <label className="field">
          <span>Size: {text.size}px</span>
          <input type="range" min={13} max={22} step={1} value={text.size} onChange={(e) => changeText({ size: +e.target.value })} />
        </label>
        <div className="row">
          <label className="field">
            <span>Notes</span>
            <select value={text.weight} onChange={(e) => changeText({ weight: +e.target.value })}>
              <option value={300}>Light</option>
              <option value={400}>Regular</option>
              <option value={500}>Medium</option>
            </select>
          </label>
          <label className="field">
            <span>Moves</span>
            <select value={text.moveWeight} onChange={(e) => changeText({ moveWeight: +e.target.value })}>
              <option value={500}>Medium</option>
              <option value={600}>Semibold</option>
              <option value={700}>Bold</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Line spacing</span>
            <select value={text.leading} onChange={(e) => changeText({ leading: +e.target.value })}>
              <option value={1.25}>Compact</option>
              <option value={1.4}>Normal</option>
              <option value={1.6}>Roomy</option>
            </select>
          </label>
          <label className="field">
            <span>Paragraph gap</span>
            <select value={text.paraGap} onChange={(e) => changeText({ paraGap: +e.target.value })}>
              <option value={0}>None</option>
              <option value={0.3}>Small</option>
              <option value={0.6}>Normal</option>
              <option value={1}>Large</option>
            </select>
          </label>
          <label className="field">
            <span>Font</span>
            <select value={text.font} onChange={(e) => changeText({ font: e.target.value as TextPrefs['font'] })}>
              <option value="system">System</option>
              <option value="serif">Serif</option>
            </select>
          </label>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={text.tight} onChange={(e) => changeText({ tight: e.target.checked })} />
          <span>Tighter letter spacing</span>
        </label>
        <button type="button" className="link-btn" onClick={() => changeText(DEFAULT_TEXT)}>Reset text settings</button>
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Engine</h2>
          <span className="muted small">Stockfish depth and lines</span>
        </summary>
        <div className="stack">
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
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Backup</h2>
          <span className="muted small">Save or restore your hives</span>
        </summary>
        <div className="stack">
        <p className="muted small">
          Your hives live on this device. Save a backup to Files or iCloud Drive now and then.
          {persisted === false && ' Storage is not yet marked as persistent; adding the app to your Home Screen fixes that.'}
        </p>
        <p className="muted small">
          The backup covers openings and training progress. Stings (tactics cards and their screenshots) join the backup
          in an upcoming update.
        </p>
        <button type="button" className="primary wide" onClick={doExport}>Save a backup</button>
        <label className="file-drop compact">
          <input type="file" accept="application/json,.json" onChange={(e) => doImport(e.target.files?.[0])} />
          <span>Restore from a backup file</span>
        </label>
        {msg && <p className="small">{msg}</p>}
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>About</h2>
          <span className="muted small">Version {appVersion}</span>
        </summary>
        <div className="stack">
          <p className="small">
            Apiary version <b>{appVersion}</b>
            {buildTime && <span className="muted"> · built {new Date(buildTime).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
          </p>
          <button
            type="button"
            className="wide"
            disabled={updateMsg === 'Checking…'}
            onClick={async () => {
              setUpdateMsg('Checking…');
              setUpdateMsg((await checkForUpdate()) ? 'A new version is ready: tap Reload at the bottom.' : 'You have the latest version.');
            }}
          >
            Check for updates
          </button>
          {updateMsg && <p className="muted small">{updateMsg}</p>}
        </div>
      </details>
      <h3 className="set-head">Opening trainer</h3>
      <details className="set-group">
        <summary>
          <h2>Moves in your text</h2>
          <span className="muted small">Clickable and bold moves</span>
        </summary>
        <div className="stack">
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
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Lines</h2>
          <span className="muted small">Line order and markers</span>
        </summary>
        <div className="stack">
        <label className="field">
          <span>Order of lines in a comb</span>
          <select value={order} onChange={(e) => { const v = e.target.value as 'mainLast' | 'mainFirst'; setOrder(v); setLineOrder(v); }}>
            <option value="mainLast">Main line last (Chessable style): side lines in study order, then the main line</option>
            <option value="mainFirst">Main line first</option>
          </select>
        </label>
        <p className="muted small">Changing the order renumbers lines but keeps their names, drill choices and progress.</p>
        <label className="toggle">
          <input type="checkbox" checked={markers} onChange={(e) => { setMarkers(e.target.checked); setShowMarkers(e.target.checked); }} />
          <span>Show small markers beside moves: ⑂ other moves here, ⇄ same position elsewhere (tap to see them)</span>
        </label>
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Training</h2>
          <span className="muted small">Review ladder, misses, honey</span>
        </summary>
        <div className="stack">
        <p className="muted small">
          Each of your moves climbs one step of the review ladder when you get it right. Steps use m, h, d, w, mo or y.
        </p>
        <label className="field">
          <span>Review ladder</span>
          <input value={ladderText} onChange={(e) => saveLadder(e.target.value)} aria-label="Review ladder" />
        </label>
        <div className="row">
          <button type="button" onClick={() => saveLadder(formatLadder(DEFAULT_LADDER))}>Your default</button>
          <button type="button" onClick={() => saveLadder(formatLadder(CHESSABLE_LADDER))}>Chessable's ladder</button>
        </div>
        {ladderMsg && <p className="small">{ladderMsg}</p>}
        <div className="row">
          <label className="field">
            <span>A miss in a review</span>
            <select value={miss} onChange={(e) => { setMiss(e.target.value as MissPolicy); setMissPolicy(e.target.value as MissPolicy); }}>
              <option value="reset">Back to the first step</option>
              <option value="back2">Down two steps</option>
              <option value="back1">Down one step</option>
            </select>
          </label>
          <label className="field">
            <span>After a miss, replay from</span>
            <select value={retry} onChange={(e) => { setRetry(+e.target.value); setRetryBack(+e.target.value); }}>
              <option value={0}>That move</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} of your moves back</option>)}
              <option value={9}>The start of the line</option>
            </select>
          </label>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={reviewNotes} onChange={(e) => { setRN(e.target.checked); setReviewNotes(e.target.checked); }} />
          <span>Show the notes during reviews (never ahead of the board)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showNew} onChange={(e) => { setSN(e.target.checked); setShowNewMoves(e.target.checked); }} />
          <span>When learning, show each new move with an arrow first</span>
        </label>
        <div className="row">
          <label className="field">
            <span>Honey per move learned</span>
            <select value={hl} onChange={(e) => { setHl(+e.target.value); setHoneyLearn(+e.target.value); }}>
              {[0, 1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Honey per correct review</span>
            <select value={hr} onChange={(e) => { setHr(+e.target.value); setHoneyReview(+e.target.value); }}>
              {[0, 1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        </div>
      </details>
      <details className="set-group">
        <summary>
          <h2>Lichess</h2>
          <span className="muted small">Study downloads and token</span>
        </summary>
        <div className="stack">
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
        </div>
      </details>
    </div>
  );
}
