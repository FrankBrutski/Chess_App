import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf } from '../lib/db';
import { parseChapters, type ParsedChapter } from '../lib/pgn';
import { fetchStudyPgn, parseStudyUrl, studyUrl } from '../lib/lichess';
import { annotateChapter, countInlineLines } from '../lib/annotations';
import { checkChapter, hasBlockingError } from '../lib/checker';
import { IssueList } from '../components/IssueList';
import { applySync, createCourse, planSync } from '../lib/importer';
import { countMoves } from '../lib/tree';
import { navigate } from '../router';
import { getAutoLink, getLichessEnabled, getToken } from '../lib/prefs';

type Source = 'link' | 'file' | 'paste';

export function ImportPage({ courseId }: { courseId?: string }) {
  const course = useLiveQuery(async () => (courseId ? (await db.courses.get(courseId)) ?? null : null), [courseId]);
  const existing = useLiveQuery(async () => (courseId ? chaptersOf(courseId) : []), [courseId]);

  const lichessOn = getLichessEnabled();
  const [source, setSource] = useState<Source>(lichessOn ? 'link' : 'file');
  const [link, setLink] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [parsed, setParsed] = useState<ParsedChapter[]>();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [linkedUrl, setLinkedUrl] = useState<string>();

  useEffect(() => {
    if (course?.sourceUrl) setLink(course.sourceUrl);
    if ((course && !course.sourceUrl) || !lichessOn) setSource('file');
  }, [course]);

  const load = (text: string, url?: string) => {
    try {
      const chapters = parseChapters(text);
      if (!chapters.length) throw new Error('No chapters with moves were found in that PGN.');
      setParsed(chapters);
      // Chapters whose main line is broken start unticked; you can still tick them.
      const auto = getAutoLink();
      setPicked(new Set(chapters.map((c, i) => (hasBlockingError(checkChapter(c, { auto })) ? -1 : i)).filter((i) => i >= 0)));
      setName(course?.name ?? chapters[0].studyName ?? 'New hive');
      setLinkedUrl(url ?? (chapters[0].lichessStudyId ? studyUrl({ studyId: chapters[0].lichessStudyId }) : undefined));
      setError(undefined);
    } catch (e) {
      setParsed(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fromLink = async () => {
    const ref = parseStudyUrl(link);
    if (!ref) { setError('That does not look like a Lichess study link (lichess.org/study/…).'); return; }
    setBusy(true);
    setError(undefined);
    try {
      const pgn = await fetchStudyPgn(ref, getToken());
      load(pgn, studyUrl({ studyId: ref.studyId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    load(await file.text());
  };

  const selected = useMemo(() => parsed?.filter((_, i) => picked.has(i)) ?? [], [parsed, picked]);
  const stats = useMemo(() => {
    const auto = getAutoLink();
    return parsed?.map((c) => ({
      moves: c.root.children.reduce((n, m) => n + countMoves(m), 0),
      ...countInlineLines(annotateChapter(c.root, { auto })),
      issues: checkChapter(c, { auto }),
    }));
  }, [parsed]);
  const totals = useMemo(() => {
    const all = stats?.flatMap((s) => s.issues) ?? [];
    return { errors: all.filter((i) => i.severity === 'error').length, warnings: all.filter((i) => i.severity === 'warning').length };
  }, [stats]);
  const [result, setResult] = useState<{ fixed: number; open: number }>();
  const plan = useMemo(() => (courseId && existing ? planSync(existing, selected) : undefined), [courseId, existing, selected]);

  const save = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      if (courseId) {
        const r = await applySync(courseId, selected, source === 'link' ? linkedUrl : undefined);
        if (name.trim() && name !== course?.name) await db.courses.update(courseId, { name: name.trim() });
        if (r.fixed || r.open) { setResult(r); setBusy(false); return; }
        navigate(`/course/${courseId}`);
      } else {
        const id = await createCourse(name.trim() || 'New hive', selected, linkedUrl);
        navigate(`/course/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(courseId ? `/course/${courseId}` : '/')} aria-label="Back">‹</button>
        <h1>{courseId ? 'Update hive' : 'New hive'}</h1>
        <span />
      </header>

      {!parsed && (
        <>
          <div className="segmented" role="tablist">
            {((lichessOn ? ['link', 'file', 'paste'] : ['file', 'paste']) as Source[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>
                {s === 'link' ? 'Lichess link' : s === 'file' ? 'PGN file' : 'Paste PGN'}
              </button>
            ))}
          </div>

          {source === 'link' && (
            <div className="stack">
              <label className="field">
                <span>Study link</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://lichess.org/study/…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
              </label>
              <p className="muted small">Public and unlisted studies work with just the link. Use a whole study (a hive) or one chapter's link (a comb).</p>
              <button type="button" className="primary wide" disabled={busy || !link.trim()} onClick={fromLink}>
                {busy ? 'Downloading…' : 'Get study'}
              </button>
            </div>
          )}
          {source === 'file' && (
            <div className="stack">
              <label className="file-drop">
                <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" onChange={(e) => fromFile(e.target.files?.[0])} />
                <span>Choose a .pgn file</span>
                <span className="muted small">On Lichess: study menu, then Download, then the whole study.</span>
              </label>
            </div>
          )}
          {source === 'paste' && (
            <div className="stack">
              <textarea rows={10} placeholder="[Event &quot;…&quot;] 1. e4 e5 …" value={paste} onChange={(e) => setPaste(e.target.value)} />
              <button type="button" className="primary wide" disabled={!paste.trim()} onClick={() => load(paste)}>
                Read PGN
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      {result && courseId && (
        <div className="stack">
          <p className="checker-summary">
            Updated. {result.fixed ? `${result.fixed} issue${result.fixed === 1 ? '' : 's'} from last time ${result.fixed === 1 ? 'is' : 'are'} fixed. ` : ''}
            {result.open ? `${result.open} still open.` : 'No open issues.'}
          </p>
          {result.open > 0 && <button type="button" className="wide" onClick={() => navigate(`/issues/${courseId}`)}>See import issues</button>}
          <button type="button" className="primary wide" onClick={() => navigate(`/course/${courseId}`)}>Done</button>
        </div>
      )}

      {parsed && !result && (
        <div className="stack">
          <div className={`checker-summary${totals.errors ? ' has-errors' : ''}`}>
            <strong>Import check: </strong>
            {totals.errors + totals.warnings === 0
              ? 'no problems found.'
              : `${totals.errors ? `${totals.errors} main-line problem${totals.errors === 1 ? '' : 's'}, ` : ''}${totals.warnings} warning${totals.warnings === 1 ? '' : 's'}. Warnings never stop the import; you can review them later from the course.`}
          </div>
          <label className="field">
            <span>Hive name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <ul className="pick-list">
            {parsed.map((c, i) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                  />
                  <span className="pick-main">
                    <span className="card-title">{c.title}</span>
                    <span className="card-sub">
                      {stats?.[i].moves} moves · {stats?.[i].lines} lines in the text
                      {stats?.[i].bad ? ` · ${stats[i].bad} marked lines not legal` : ''} · as {c.orientation}
                    </span>
                    {stats && stats[i].issues.length > 0 && <IssueList issues={stats[i].issues} compact />}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {plan && (
            <p className="muted small">
              {plan.updated.length} combs updated, {plan.added.length} added
              {plan.removed.length ? `, ${plan.removed.length} removed (${plan.removed.map((r) => r.title).join(', ')})` : ''}.
            </p>
          )}
          <button type="button" className="primary wide" disabled={busy || !selected.length} onClick={save}>
            {courseId ? `Update ${selected.length} combs` : `Import ${selected.length} combs`}
          </button>
          <button type="button" className="wide" onClick={() => setParsed(undefined)}>Start over</button>
        </div>
      )}
    </div>
  );
}
