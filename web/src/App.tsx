import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from './app/AppContext';
import { Shell } from './components/Shell';
import { Icon, Logo } from './components/Icon';
import { Bare } from './components/ui';
import { api, ApiError, errorMessage, isAbort, onUnauthorized } from './lib/api';
import type { Me } from './lib/types';
import { Start } from './pages/Start';
import { Transacties } from './pages/Transacties';
import { Rekeningen } from './pages/Rekeningen';
import { Meer } from './pages/Meer';
import { Instellingen } from './pages/Instellingen';
import { NotBuilt } from './pages/NotBuilt';
import { LinkPage, SignIn } from './pages/Inloggen';

/** The pages of a signed-in viewer, inside the shell. */
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
        <Route path="instellingen/:section?" element={<Instellingen />} />
        <Route path="*" element={<NotBuilt id={null} />} />
      </Route>
    </Routes>
  );
}

/** Sign-in and the links from e-mails and the add-on log are public; everything else waits for the viewer. */
export function Root() {
  return (
    <Routes>
      <Route path="/inloggen" element={<SignIn />} />
      <Route path="/setup/:token" element={<LinkPage kind="setup" />} />
      <Route path="/uitnodiging/:token" element={<LinkPage kind="invitation" />} />
      <Route path="/nieuw-wachtwoord/:token" element={<LinkPage kind="password_reset" />} />
      <Route path="*" element={<Gate />} />
    </Routes>
  );
}

type Boot = { me: Me } | { error: string; status: number } | 'signed-out' | null;

/**
 * Loads the viewer (GET /api/me) before the app opens. Without a signed-in device, or when any later request
 * answers 401, it goes to sign-in and remembers the page, to come back to it afterwards. In demo mode
 * /api/me answers at once, so nobody sees sign-in.
 */
function Gate() {
  const { pathname, search } = useLocation();
  const [boot, setBoot] = useState<Boot>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setBoot(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => onUnauthorized(() => setBoot('signed-out')), []);

  useEffect(() => {
    const ctl = new AbortController();
    api.me(ctl.signal).then(
      (me) => setBoot({ me }),
      (e) => {
        if (isAbort(e)) return;
        const status = e instanceof ApiError ? e.status : 0;
        setBoot(status === 401 ? 'signed-out' : { error: errorMessage(e), status });
      },
    );
    return () => ctl.abort();
  }, [attempt]);

  if (boot === 'signed-out') {
    const here = pathname + search;
    return <Navigate to={here === '/' ? '/inloggen' : '/inloggen?terug=' + encodeURIComponent(here)} replace />;
  }

  if (boot && 'me' in boot) {
    return (
      <AppProvider me={boot.me}>
        <AppRoutes />
      </AppProvider>
    );
  }

  if (boot) {
    const offline = boot.status === 0 && typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <Bare>
        <section className="boot anim-in" role="alert">
          <span className="boot-logo">
            <Logo size={48} radius={13} />
          </span>
          <h1>{offline ? 'Je bent offline' : 'Saldo is niet bereikbaar'}</h1>
          <p>{offline ? 'Saldo bewaart geen financiële gegevens op dit toestel. Maak verbinding om je rekeningen te zien.' : boot.error}</p>
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

export function App() {
  return (
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  );
}
