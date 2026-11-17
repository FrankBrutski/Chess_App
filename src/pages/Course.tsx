import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf, deleteCourse, newId } from '../lib/db';
import { navigate } from '../router';
import { getLichessEnabled } from '../lib/prefs';
import { countMoves } from '../lib/tree';
import { splitLines } from '../lib/lines';
import { TIER_CHOICES, groupHives, moveInList, tierName } from '../lib/hives';
import { moveComb } from '../lib/importer';
import type { Chapter, Course, Section } from '../lib/model';

/** Only ever link out to lichess.org (a restored backup file could contain anything). */
const isLichessUrl = (u: string) => /^https:\/\/lichess\.org\//.test(u);

// Line and move counts per comb, worked out once per stored tree (not on every keystroke while editing).
const statsCache = new WeakMap<Chapter['root'], { lines: number; moves: number }>();
function combStats(c: Chapter) {
  let s = statsCache.get(c.root);
  if (!s) {
    s = { lines: splitLines(c.root, c.orientation).length, moves: c.root.children.reduce((n, m) => n + countMoves(m), 0) };
    statsCache.set(c.root, s);
  }
  return s;
}

export function CoursePage({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const allHives = useLiveQuery(() => db.courses.toArray(), []);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState<string>(); // comb id being moved

  const issueCount = chapters?.reduce((n, c) => n + (c.issues?.length ?? 0), 0) ?? 0;

  if (course === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (course === null) return <div className="page"><p>Hive not found.</p></div>;

  const update = (patch: Partial<Course>) => db.courses.update(course.id, { ...patch, updatedAt: Date.now() });
  const setSections = (sections: Section[]) => update({ sections });
  const combsIn = (sectionId: string) => (chapters ?? []).filter((c) => c.sectionId === sectionId).sort((a, b) => a.order - b.order);

  const addSection = () => setSections([...course.sections, { id: newId(), name: 'New section' }]);
  const renameSection = (id: string, name: string) => setSections(course.sections.map((s) => (s.id === id ? { ...s, name } : s)));
  const moveSection = (i: number, dir: -1 | 1) => {
    const next = moveInList(course.sections, i, dir);
    if (next) void setSections(next);
  };
  const deleteSection = (id: string) => setSections(course.sections.filter((s) => s.id !== id));
  const moveCombWithin = async (list: Chapter[], i: number, dir: -1 | 1) => {
    const next = moveInList(list, i, dir);
    if (!next) return;
    await db.transaction('rw', db.chapters, async () => {
      for (const [k, c] of next.entries()) await db.chapters.where('id').equals(c.id).modify((x) => { x.order = k; });
    });
  };

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <h1>{course.name}</h1>
        <button type="button" className="icon-btn small-text" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
      </header>
      <p className="muted small hive-sub">
        {course.color === 'white' ? 'White' : 'Black'} · {tierName(course.tier)} · {chapters?.length ?? 0} combs{course.skip ? ' · not drilled' : ''}
      </p>

      {editing && (
        <div className="stack edit-box">
          <label className="field">
            <span>Hive name</span>
            <input value={course.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <div className="row">
            <label className="field">
              <span>I play</span>
              <select
                value={course.color}
                onChange={async (e) => {
                  const color = e.target.value as 'white' | 'black';
                  await update({ color });
                  await db.chapters.where('courseId').equals(course.id).modify((c) => { c.orientation = color; });
                }}
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={course.tier} onChange={(e) => update({ tier: +e.target.value })}>
                {TIER_CHOICES.map((t) => <option key={t} value={t}>{tierName(t)}</option>)}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={!course.skip} onChange={(e) => update({ skip: !e.target.checked })} />
            <span>Drill this hive in training</span>
          </label>
          <button type="button" className="wide" onClick={addSection}>Add a section</button>
        </div>
      )}

      <button type="button" className="primary wide" onClick={() => navigate(`/train/hive/${course.id}`)}>Train this hive</button>

      {issueCount > 0 && (
        <button type="button" className="wide issues-link" onClick={() => navigate(`/issues/${course.id}`)}>
          Import issues ({issueCount})
        </button>
      )}

      {course.sections.map((section, si) => {
        const combs = combsIn(section.id);
        return (
          <details key={section.id} className="section" open>
            <summary>
              <span className="section-name">{section.name}</span>
              <span className="muted small">{combs.length} combs{section.skip ? ' · not drilled' : ''}</span>
            </summary>
            {editing && (
              <div className="section-tools">
                <input aria-label="Section name" value={section.name} onChange={(e) => renameSection(section.id, e.target.value)} />
                <button type="button" onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label="Move section up">▲</button>
                <button type="button" onClick={() => moveSection(si, 1)} disabled={si === course.sections.length - 1} aria-label="Move section down">▼</button>
                <label className="check" title="Drill this section in training">
                  <input type="checkbox" checked={!section.skip} onChange={(e) => setSections(course.sections.map((s) => (s.id === section.id ? { ...s, skip: !e.target.checked } : s)))} />
                  <span>Drill</span>
                </label>
                {combs.length === 0 && <button type="button" className="danger-link" onClick={() => deleteSection(section.id)}>Remove</button>}
              </div>
            )}
            <ol className="card-list chapters" aria-label={`Combs in ${section.name}`}>
              {combs.map((c, ci) => (
                <li key={c.id} className="comb-row">
                  <button type="button" className="card" onClick={() => navigate(`/read/${c.id}`)}>
                    <span className="card-title">{c.title}</span>
                    <span className="card-sub">
                      {combStats(c).lines} line{combStats(c).lines === 1 ? '' : 's'} · {combStats(c).moves} moves
                      {c.issues?.length ? ` · ${c.issues.length} issue${c.issues.length === 1 ? '' : 's'}` : ''}
                      {c.skip ? ' · not drilled' : c.skipLines?.length ? ` · ${c.skipLines.length} skipped` : ''}
                    </span>
                  </button>
                  {editing && (
                    <div className="comb-tools">
                      <button type="button" onClick={() => moveCombWithin(combs, ci, -1)} disabled={ci === 0} aria-label="Move comb up">▲</button>
                      <button type="button" onClick={() => moveCombWithin(combs, ci, 1)} disabled={ci === combs.length - 1} aria-label="Move comb down">▼</button>
                      <button type="button" onClick={() => setMoving(moving === c.id ? undefined : c.id)}>Move…</button>
                      <button
                        type="button"
                        className={`drill-btn${c.skip ? ' off' : ''}`}
                        aria-pressed={!c.skip}
                        onClick={() => db.chapters.where('id').equals(c.id).modify((x) => { x.skip = !x.skip; })}
                        title="Drill this comb in training"
                      >
                        {c.skip ? 'Skip' : 'Drill'}
                      </button>
                    </div>
                  )}
                  {editing && moving === c.id && (
                    <label className="field move-to">
                      <span>Move “{c.title}” to (its progress comes with it)</span>
                      <select
                        defaultValue=""
                        onChange={async (e) => {
                          const [hiveId, secId] = e.target.value.split('|');
                          if (!hiveId) return;
                          await moveComb(c.id, hiveId, secId);
                          setMoving(undefined);
                        }}
                      >
                        <option value="" disabled>Choose a section…</option>
                        {groupHives(allHives ?? []).flatMap((g) =>
                          g.tiers.flatMap((t) =>
                            t.hives.map((h) => (
                              <optgroup key={h.id} label={`${h.name} (${g.color === 'white' ? 'White' : 'Black'}, ${tierName(h.tier)})`}>
                                {h.sections.map((s) => (
                                  <option key={s.id} value={`${h.id}|${s.id}`} disabled={s.id === section.id}>{s.name}</option>
                                ))}
                              </optgroup>
                            )),
                          ),
                        )}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ol>
            <div className="section-actions">
              {combs.length > 0 && <button type="button" onClick={() => navigate(`/train/section/${course.id}/${section.id}`)}>Train section</button>}
              <button type="button" onClick={() => navigate(`/import/${course.id}/${section.id}`)}>
                {section.sourceUrl && getLichessEnabled() ? 'Sync from Lichess' : 'Upload a new version'}
              </button>
              {section.sourceUrl && isLichessUrl(section.sourceUrl) && (
                <a className="muted small" href={section.sourceUrl} target="_blank" rel="noreferrer">Open on Lichess</a>
              )}
            </div>
          </details>
        );
      })}

      <div className="stack">
        <button type="button" className="wide" onClick={() => navigate(`/import/${course.id}`)}>
          Import a study into this hive
        </button>
        {!editing ? null : !confirming ? (
          <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Delete hive</button>
        ) : (
          <div className="confirm">
            <span>Delete “{course.name}” and all its combs from this device?</span>
            <button type="button" className="danger" onClick={async () => { await deleteCourse(course.id); navigate('/'); }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
