'use client';

import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const KEY = 'tandoor_theme';

/** Apply before paint so the board never flashes the wrong ground. */
export const THEME_BOOT = `(function(){try{var m=localStorage.getItem('${KEY}');
if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m);}catch(e){}})();`;

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    const saved = localStorage.getItem(KEY) as Mode | null;
    if (saved === 'light' || saved === 'dark') setMode(saved);
  }, []);

  function choose(next: Mode) {
    setMode(next);
    if (next === 'system') {
      localStorage.removeItem(KEY);
      document.documentElement.removeAttribute('data-theme');
    } else {
      localStorage.setItem(KEY, next);
      document.documentElement.setAttribute('data-theme', next);
    }
  }

  // Cycles rather than toggles, so "follow the room" stays reachable — a kitchen
  // screen that flips itself at dusk is doing the right thing unasked.
  const next: Mode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
  const face = mode === 'system' ? '◐' : mode === 'light' ? '☀' : '☾';
  const said =
    mode === 'system' ? 'Following the system' : mode === 'light' ? 'Light' : 'Dark';

  return (
    <button
      onClick={() => choose(next)}
      className="btn btn-ghost !min-h-[30px] !px-2.5"
      title={`${said} — tap for ${next === 'system' ? 'system' : next}`}
      aria-label={`Theme: ${said}. Switch to ${next}.`}
    >
      <span aria-hidden="true" className="text-[14px] leading-none">{face}</span>
    </button>
  );
}
