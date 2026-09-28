export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'claude-inspect.theme';

function load(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state<{ mode: ThemeMode }>({ mode: load() });

/** Applies the mode to <html data-theme>; "system" removes it so the OS setting wins. */
export function applyTheme(mode: ThemeMode): void {
  theme.mode = mode;
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* private mode etc. – the choice then only lasts for this page view */
  }
}

export function cycleTheme(): void {
  applyTheme(theme.mode === 'system' ? 'light' : theme.mode === 'light' ? 'dark' : 'system');
}
