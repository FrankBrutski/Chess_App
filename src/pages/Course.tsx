import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf, deleteCourse } from '../lib/db';
import { navigate } from '../router';
import { getLichessEnabled } from '../lib/prefs';
import { countMoves } from '../lib/tree';
import { splitLines } from '../lib/lines';
import { TIER_CHOICES, UNSECTIONED, groupHives, moveInList, tierName } from '../lib/hives';
import { deleteSection, moveComb, setSectionCombs } from '../lib/importer';
import type { Chapter, Course, Section } from '../lib/model';
import { trainLinesOf } from '../lib/training';
import { lineState, userKeys, type Cell } from '../lib/srs';
import { ProgressRing } from '../components/ProgressRing';


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

export function CoursePage({ courseId, startEditing = false }: { courseId: string; startEditing?: boolean }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const allHives = useLiveQuery(() => db.courses.toArray(), []);
  const [editing, setEditing] = useState(startEditing);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState<string>(); // comb id being moved
  /** Section whose ⋯ menu is open. */
  const [menuFor, setMenuFor] = useState<string>();
  /** + Section (sectionId undefined) or Choose combs for a section. */
  const [picking, setPicking] = useState<{ sectionId?: string }>();
  const cells = useLiveQuery(async () => new Map<string, Cell>((await db.cells.toArray()).map((c) => [c.key, c])), []);
  /** Drillable lines in a comb and how many are learned (skipped combs and lines don't count). */
  const progress = (c: Chapter) => {
    const lines = trainLinesOf([c], false, allHives ?? []);
    const now = Date.now();
    return { total: lines.length, learned: cells ? lines.filter((t) => lineState(t, cells, now) !== 'new').length : 0 };
  };

  const issueCount = chapters?.reduce((n, c) => n + (c.issues?.length ?? 0), 0) ?? 0;
  // Your moves due for review in this hive (a move shared by several lines counts once).
  const due = (() => {
    if (!chapters || !cells || !allHives) return 0;
    const now = Date.now();
    return new Set(trainLinesOf(chapters, false, allHives).flatMap(userKeys).filter((k) => (cells.get(k)?.due ?? Infinity) <= now)).size;
  })();

  if (course === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (course === null) return <div className="page"><p>Hive not found.</p></div>;

  const update = (patch: Partial<Course>) => db.courses.update(course.id, { ...patch, updatedAt: Date.now() });
  const setSections = (sections: Section[]) => update({ sections });
  const valid = new Set(course.sections.map((s) => s.id));
  const combsIn = (sectionId: string) =>
    (chapters ?? []).filter((c) => (sectionId ? c.sectionId === sectionId : !c.sectionId || !valid.has(c.sectionId))).sort((a, b) => a.order - b.order);
  const loose = combsIn('');
  // Sections are optional: combs in no section are a plain list at the top, with no header.
  const groups: { section?: Section; combs: Chapter[] }[] = [
    ...(loose.length ? [{ combs: loose }] : []),
    ...course.sections.map((section) => ({ section, combs: combsIn(section.id) })),
  ];

  const renameSection = (id: string, name: string) => setSections(course.sections.map((s) => (s.id === id ? { ...s, name } : s)));
  const moveSection = (i: number, dir: -1 | 1) => {
    const next = moveInList(course.sections, i, dir);
    if (next) void setSections(next);
  };
  const moveCombWithin = async (list: Chapter[], i: number, dir: -1 | 1) => {
    const next = moveInList(list, i, dir);
    if (!next) return;
    await db.transaction('rw', db.chapters, async () => {
      for (const [k, c] of next.entries()) await db.chapters.where('id').equals(c.id).modify((x) => { x.order = k; });
    });
  };
  const canSync = !!course.sources?.length && getLichessEnabled();
  const menuIndex = course.sections.findIndex((s) => s.id === menuFor);
  const menuSection = course.sections[menuIndex];

  return (
    <div className={`page${!editing && due ? ' has-fab' : ''}`}>
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/openings')} aria-label="Back to openings">‹</button>
        <h1>{course.name}</h1>
        <button type="button" className="icon-btn small-text" onClick={() => { setEditing(!editing); setMoving(undefined); }}>{editing ? 'Done' : 'Edit'}</button>
      </header>
      <p className="muted small hive-sub">
        {course.color === 'white' ? 'White' : 'Black'} · {tierName(course.tier)} · {chapters?.length ?? 0} comb{chapters?.length === 1 ? '' : 's'}{course.skip ? ' · not drilled' : ''}
      </p>

      {editing && (
        <div className="hive-edit-actions">
          {!confirming ? (
            <>
              <button type="button" onClick={() => navigate(`/import/${course.id}`)}>Import study</button>
              {(chapters?.length ?? 0) > 0 && (
                <button type="button" onClick={() => navigate(`/import/${course.id}/sync`)}>{canSync ? 'Sync' : 'Re-upload'}</button>
              )}
              <button type="button" onClick={() => setPicking({})}>+ Section</button>
              <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Delete hive</button>
            </>
          ) : (
            <div className="confirm">
              <span>Delete “{course.name}” and all its combs from this device? Learned moves and honey are kept.</span>
              <button type="button" className="danger" onClick={async () => { await deleteCourse(course.id); navigate('/openings'); }}>
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="stack edit-box">
          <label className="field">
            <span>Hive name</span>
            <input value={course.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={course.tier} onChange={(e) => update({ tier: +e.target.value })}>
              {TIER_CHOICES.map((t) => <option key={t} value={t}>{tierName(t)}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!course.skip} onChange={(e) => update({ skip: !e.target.checked })} />
            <span>Drill this hive in training</span>
          </label>
        </div>
      )}

      {issueCount > 0 && (
        <button type="button" className="wide issues-link" onClick={() => navigate(`/issues/${course.id}`)}>
          Import issues ({issueCount})
        </button>
      )}

      {groups.map(({ section, combs }) => {
        const list = (
            <ol className="comb-lines chapters" aria-label={section ? `Combs in ${section.name}` : 'Combs'}>
              {combs.map((c, ci) => (
                <li key={c.id} className="comb-row">
                  <button
                    type="button"
                    className="comb-line"
                    onClick={() => {
                      // Opening a new comb means you've seen it: drop its NEW tag.
                      if (c.fresh) void db.chapters.where('id').equals(c.id).modify((x) => { delete x.fresh; });
                      navigate(`/comb/${c.id}`);
                    }}
                  >
                    {(() => {
                      const pr = progress(c);
                      return (
                        <>
                          <ProgressRing done={pr.learned} total={pr.total} />
                          <span className="comb-line-text">
                            <span className="card-title">{c.title}{c.fresh && <span className="new-tag">NEW</span>}</span>
                            <span className="card-sub">
                              {pr.total ? `${pr.learned} / ${pr.total} line${pr.total === 1 ? "" : "s"} learned` : `${combStats(c).lines} line${combStats(c).lines === 1 ? '' : 's'} · not drilled`}
                              {c.issues?.length ? ` · ${c.issues.length} issue${c.issues.length === 1 ? '' : 's'}` : ''}
                              {!c.skip && c.skipLines?.length ? ` · ${c.skipLines.length} skipped` : ''}
                            </span>
                          </span>
                        </>
                      );
                    })()}
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
                                  <option key={s.id} value={`${h.id}|${s.id}`} disabled={s.id === section?.id}>{s.name}</option>
                                ))}
                                <option value={`${h.id}|`} disabled={h.id === course.id && !section}>{UNSECTIONED}</option>
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
        );
        if (!section) return <div key="__loose" className="loose-combs">{list}</div>;
        return (
          <details key={section?.id ?? '__loose'} className="section" open>
            <summary>
              <span className="section-name">{section.name}</span>
              <span className="muted small">{combs.length} comb{combs.length === 1 ? '' : 's'}{section.skip ? ' · not drilled' : ''}</span>
              {editing && (
                <button
                  type="button"
                  className="more-btn section-more"
                  aria-label={`${section.name}: more`}
                  onClick={(e) => { e.preventDefault(); setMenuFor(section.id); }}
                >
                  ⋯
                </button>
              )}
            </summary>
            {list}
          </details>
        );
      })}

      <div className="stack">
        {!editing && chapters?.length === 0 && (
          <button type="button" className="wide" onClick={() => navigate(`/import/${course.id}`)}>
            Import a study into this hive
          </button>
        )}
      </div>

      {!editing && !!due && (
        <button type="button" className="review-all" onClick={() => navigate(`/train/hive/${course.id}/review`)}>
          Review <span>({due})</span>
        </button>
      )}

      {editing && menuSection && (
        <>
          <div className="sheet-bg" onClick={() => setMenuFor(undefined)} />
          <div className="bottom-sheet section-menu" role="dialog" aria-label={`Section ${menuSection.name}`}>
            <div className="sheet-grip" />
            <input aria-label="Section name" value={menuSection.name} onChange={(e) => renameSection(menuSection.id, e.target.value)} />
            <div className="menu-rows">
              <button type="button" disabled={menuIndex === 0} onClick={() => moveSection(menuIndex, -1)}>▲ Move up <span>its combs move with it</span></button>
              <button type="button" disabled={menuIndex === course.sections.length - 1} onClick={() => moveSection(menuIndex, 1)}>▼ Move down</button>
              <button type="button" onClick={() => { setPicking({ sectionId: menuSection.id }); setMenuFor(undefined); }}>Choose combs…</button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!menuSection.skip}
                  onChange={(e) => setSections(course.sections.map((s) => (s.id === menuSection.id ? { ...s, skip: !e.target.checked } : s)))}
                />
                <span>Drill this section in training</span>
              </label>
              <button type="button" className="danger-link" onClick={async () => { await deleteSection(course.id, menuSection.id); setMenuFor(undefined); }}>
                Delete section
              </button>
            </div>
            <p className="muted small">
              Deleting moves its {combsIn(menuSection.id).length} comb{combsIn(menuSection.id).length === 1 ? '' : 's'} to the top of the hive, outside any
              section. Progress, names, line order and skipped lines stay.
            </p>
            <button type="button" className="primary wide" onClick={() => setMenuFor(undefined)}>Done</button>
          </div>
        </>
      )}

      {editing && picking && (
        <SectionPicker
          course={course}
          combs={chapters ?? []}
          sectionId={picking.sectionId}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}

/** + Section / Choose combs: name the section and tick which of the hive's combs it holds. */
function SectionPicker({ course, combs, sectionId, onClose }: { course: Course; combs: Chapter[]; sectionId?: string; onClose: () => void }) {
  const current = course.sections.find((s) => s.id === sectionId);
  const [name, setName] = useState(current?.name ?? '');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(combs.filter((c) => sectionId && c.sectionId === sectionId).map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const nameOf = new Map(course.sections.map((s) => [s.id, s.name]));
  // Unsectioned combs first: they are the ones you most likely want to file.
  const list = [...combs].sort((a, b) => Number(nameOf.has(a.sectionId)) - Number(nameOf.has(b.sectionId)));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    await setSectionCombs(course.id, sectionId, name, list.filter((c) => picked.has(c.id)).map((c) => c.id));
    onClose();
  };
  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="bottom-sheet section-picker" role="dialog" aria-label={current ? `Combs in ${current.name}` : 'New section'}>
        <div className="sheet-grip" />
        <h2>{current ? current.name : 'New section'}</h2>
        <input aria-label="Section name" placeholder="Section name, e.g. Classical" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!current} />
        <ul className="pick-list compact" aria-label="Combs in this hive">
          {list.map((c) => {
            const from = nameOf.get(c.sectionId);
            const on = picked.has(c.id);
            return (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
                  <span className="pick-main">{c.title}</span>
                  <span className="pick-from">{c.sectionId === sectionId && sectionId ? '' : from ? (on ? `from ${from}` : from) : UNSECTIONED}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button type="button" className="wide" onClick={onClose}>Cancel</button>
          <button type="button" className="primary wide" disabled={busy || (!current && !name.trim())} onClick={save}>
            {current ? 'Save' : `Create (${picked.size})`}
          </button>
        </div>
      </div>
    </>
  );
}
