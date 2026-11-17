import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';

/** Shows a stored screenshot from the on-device database (a blob: URL, never a network request). */
export function ShotImage({ shotId, className, alt = '' }: { shotId?: string; className?: string; alt?: string }) {
  const shot = useLiveQuery(() => (shotId ? db.shots.get(shotId) : undefined), [shotId]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!shot) return setUrl(undefined);
    const u = URL.createObjectURL(shot.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [shot]);
  if (!url) return <div className={`shot-empty ${className ?? ''}`} aria-hidden="true" />;
  return <img className={className} src={url} alt={alt} decoding="async" />;
}
