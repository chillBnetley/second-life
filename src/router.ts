import { useCallback, useEffect, useState } from 'react';

const read = () => (typeof window === 'undefined' ? '/' : window.location.hash.replace(/^#/, '') || '/');

/** 极简 hash 路由：刷新页面后仍停留在当前页（#/play、#/social …） */
export function useHashRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((p: string) => { window.location.hash = p; window.scrollTo({ top: 0 }); }, []);
  return [path, go];
}
