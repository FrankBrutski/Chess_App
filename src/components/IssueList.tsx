import { useState } from 'react';
import type { Issue } from '../lib/model';

interface Props {
  issues: Issue[];
  /** Collapsed to a one-line count until tapped. */
  compact?: boolean;
  onOpen?: (issue: Issue) => void;
}

export function IssueList({ issues, compact, onOpen }: Props) {
  const [open, setOpen] = useState(!compact);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <div className="issues">
      {compact && (
        <button type="button" className="issues-toggle" onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
          {errors > 0 && <span className="sev sev-error">{errors} main-line</span>}
          {warnings > 0 && <span className="sev sev-warning">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
          <span className="muted">{open ? 'Hide' : 'Show'}</span>
        </button>
      )}
      {open && (
        <ul className="issue-list">
          {sorted.map((i, k) => (
            <li key={k} className={`issue issue-${i.severity}`}>
              {onOpen && i.nodeId ? (
                <button type="button" className="issue-btn" onClick={() => onOpen(i)}>
                  {i.message} <span className="issue-go">Show ›</span>
                  {i.detail && <span className="issue-detail">{i.detail}</span>}
                </button>
              ) : (
                <span>{i.message}{i.detail && <span className="issue-detail">{i.detail}</span>}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
