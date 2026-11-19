import { useState } from 'react';
import type { Issue } from '../lib/model';
import { issueType, issueTypeLabel, withoutLinePrefix } from '../lib/issueTypes';

interface Props {
  issues: Issue[];
  /** Collapsed to a one-line count until tapped. */
  compact?: boolean;
  onOpen?: (issue: Issue) => void;
  /** The line an issue is in, e.g. "Line 2 · 10.Nd2 10…Na6", shown next to its type. */
  lineOf?: (issue: Issue) => string | undefined;
}

export function IssueList({ issues, compact, onOpen, lineOf }: Props) {
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
          {sorted.map((i, k) => {
            const line = lineOf?.(i);
            const body = (
              <>
                <span className="issue-tag">
                  {issueTypeLabel(issueType(i))}
                  {line && <span className="where"> · {line}</span>}
                </span>
                {line ? withoutLinePrefix(i.message) : i.message}
              </>
            );
            return (
              <li key={k} className={`issue issue-${i.severity}`}>
                {onOpen && i.nodeId ? (
                  <button type="button" className="issue-btn" onClick={() => onOpen(i)}>
                    {body} <span className="issue-go">Show ›</span>
                    {i.detail && <span className="issue-detail">{i.detail}</span>}
                  </button>
                ) : (
                  <span>{body}{i.detail && <span className="issue-detail">{i.detail}</span>}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
