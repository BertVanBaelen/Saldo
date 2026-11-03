import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './app/AppContext';
import { Shell } from './components/Shell';
import { Icon, Logo } from './components/Icon';
import { api, ApiError, errorMessage, isAbort } from './lib/api';
import type { Me } from './lib/types';
import { Start } from './pages/Start';
import { Transacties } from './pages/Transacties';
import { Rekeningen } from './pages/Rekeningen';
import { Meer } from './pages/Meer';
import { NotBuilt } from './pages/NotBuilt';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Start />} />
        <Route path="transacties" element={<Transacties />} />
        <Route path="rekeningen" element={<Rekeningen />} />
        <Route path="meer" element={<Meer />} />
        <Route path="overzicht" element={<NotBuilt id="overzicht" />} />
        <Route path="planning" element={<NotBuilt id="planning" />} />
        <Route path="bankkoppelingen" element={<NotBuilt id="bankkoppelingen" />} />
        <Route path="categorieen" element={<NotBuilt id="categorieen" />} />
        <Route path="importeren" element={<NotBuilt id="importeren" />} />
        <Route path="meldingen" element={<NotBuilt id="meldingen" />} />
        <Route path="instellingen" element={<NotBuilt id="instellingen" />} />
        <Route path="*" element={<NotBuilt id={null} />} />
      </Route>
    </Routes>
  );
}

/** Pages without navigation (boot, later sign-in): a centred column with the logo (analysis/concepts/app-shell.md). */
function Bare({ children }: { children: ReactNode }) {
  return (
    <div className="app app--bare">
      <main className="main main--bare" id="main">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

type Boot = { me: Me } | { error: string; status: number } | null;

export function App() {
  const [boot, setBoot] = useState<Boot>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setBoot(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    api.me(ctl.signal).then(
      (me) => setBoot({ me }),
      (e) => {
        if (isAbort(e)) return;
        setBoot({ error: errorMessage(e), status: e instanceof ApiError ? e.status : 0 });
      },
    );
    return () => ctl.abort();
  }, [attempt]);

  if (boot && 'me' in boot) {
    return (
      <AppProvider me={boot.me}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProvider>
    );
  }

  if (boot) {
    const signedOut = boot.status === 401;
    const offline = boot.status === 0 && typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <Bare>
        <section className="boot anim-in" role="alert">
          <span className="boot-logo">
            <Logo size={48} radius={13} />
          </span>
          <h1>{signedOut ? 'Je bent niet aangemeld' : offline ? 'Je bent offline' : 'Saldo is niet bereikbaar'}</h1>
          <p>{offline ? 'Saldo bewaart geen financiële gegevens op dit toestel. Maak verbinding om je rekeningen te zien.' : boot.error}</p>
          {signedOut && <p className="boot-note">Aanmelden komt in een volgende stap van versie 0.2. Tot dan opent Saldo alleen in demo-modus.</p>}
          <button type="button" className="btn btn--primary" onClick={retry}>
            <Icon name="sync" size={18} stroke={2.2} />
            Opnieuw proberen
          </button>
        </section>
      </Bare>
    );
  }

  return (
    <Bare>
      <div className="boot" role="status" aria-label="Saldo laden">
        <span className="boot-logo boot-logo--pulse">
          <Logo size={48} radius={13} />
        </span>
      </div>
    </Bare>
  );
}
