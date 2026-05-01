const KEY = 'codex-cn-proxy-theme';

export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme {
  try { if (localStorage.getItem(KEY) === 'light') return 'light'; } catch {}
  return 'dark';
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'light') {
    root.classList.add('light');
  } else {
    root.classList.remove('light');
  }
  try { localStorage.setItem(KEY, t); } catch {}
}

export function toggleTheme(): Theme {
  const current = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
