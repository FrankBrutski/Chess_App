import { useEffect, useState } from 'react';

/** Tiny hash router: works on GitHub Pages and from the home screen without server config. */
export function navigate(path: string) {
  window.location.hash = path;
}

export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
