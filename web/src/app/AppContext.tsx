// App-wide state: the viewer, scope switch, theme, toasts, online status, sync and the shell's counts.
// See analysis/concepts/app-shell.md and analysis/concepts/scope.md.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Alert, Me, Scope, Theme, User } from '../lib/types';

export interface Toast {
  id: number;
  text: string;
}

export interface UncategorisedCount {
  count: number;
  /** True when there are more than the counted page holds. */
  more: boolean;
}

export interface AppContextValue {
  me: Me;
  /** Show a changed profile (name) everywhere at once. */
  setUser: (u: User) => void;
  today: string;
  scope: Scope;
  setScope: (s: Scope) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toast: (text: string) => void;
  current: Toast | null;
  online: boolean;
  /** When the figures on screen were last loaded from the server. */
  loadedAt: Date;
  alerts: Alert[] | null;
  uncategorised: UncategorisedCount | null;
  refreshShell: () => void;
  syncing: boolean;
  startSync: () => void;
  /** Goes up after a sync, so screens load their data again. */
  dataVersion: number;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Page size used to count uncategorised transactions for the badge and the chip. */
export const COUNT_LIMIT = 200;
const SYNC_MIN_MS = 1600;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem('saldo.theme', theme);
  } catch {
    /* private mode */
  }
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function AppProvider({ me: initial, children }: { me: Me; children: ReactNode }) {
  const [user, setUser] = useState<User>(initial.user);
  const me = useMemo<Me>(() => ({ ...initial, user }), [initial, user]);
  const [scope, setScopeState] = useState<Scope>(me.preferences.scope);
  const [theme, setThemeState] = useState<Theme>(me.preferences.theme);
  const [current, setCurrent] = useState<Toast | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [uncategorised, setUncategorised] = useState<UncategorisedCount | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const online = useOnline();
  const toastTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);
  const syncingRef = useRef(false);
  const scopeRef = useRef(scope);

  useEffect(() => applyTheme(theme), [theme]);

  const toast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    toastId.current += 1;
    setCurrent({ id: toastId.current, text });
    toastTimer.current = window.setTimeout(() => setCurrent(null), 2700);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // The choice works at once; it is saved per user on the server (offline it stays local).
  const save = useCallback(
    (prefs: { scope?: Scope; theme?: Theme }) => {
      if (!isOnline()) return;
      api.savePreferences(prefs).catch((e) => toast(errorMessage(e)));
    },
    [toast],
  );

  const setScope = useCallback(
    (s: Scope) => {
      if (scopeRef.current === s) return;
      scopeRef.current = s;
      setScopeState(s);
      save({ scope: s });
    },
    [save],
  );

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      save({ theme: t });
    },
    [save],
  );

  const refreshShell = useCallback(() => {
    api.alerts().then(
      (a) => {
        setAlerts(a);
        setLoadedAt(new Date());
      },
      () => setAlerts((a) => a ?? []),
    );
    api.transactions({ uncategorised: true, limit: COUNT_LIMIT }).then(
      (p) => setUncategorised({ count: p.items.length, more: p.next !== null }),
      () => undefined,
    );
  }, []);

  useEffect(() => refreshShell(), [refreshShell]);

  // Sync now: spinner and progress bar for at least 1.6 s, then the screens load their data again.
  const startSync = useCallback(() => {
    if (!isOnline()) {
      toast('Offline · synchroniseren kan niet');
      return;
    }
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    const started = Date.now();
    const finish = (text: string, reload: boolean) => {
      const wait = Math.max(0, SYNC_MIN_MS - (Date.now() - started));
      window.setTimeout(() => {
        syncingRef.current = false;
        setSyncing(false);
        if (reload) {
          setDataVersion((v) => v + 1);
          refreshShell();
        }
        toast(text);
      }, wait);
    };
    api.sync().then(
      () => finish('Bijgewerkt', true),
      (e) => finish(errorMessage(e), false),
    );
  }, [refreshShell, toast]);

  const value = useMemo<AppContextValue>(
    () => ({
      me,
      setUser,
      today: me.today,
      scope,
      setScope,
      theme,
      setTheme,
      toast,
      current,
      online,
      loadedAt,
      alerts,
      uncategorised,
      refreshShell,
      syncing,
      startSync,
      dataVersion,
    }),
    [me, scope, setScope, theme, setTheme, toast, current, online, loadedAt, alerts, uncategorised, refreshShell, syncing, startSync, dataVersion],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
