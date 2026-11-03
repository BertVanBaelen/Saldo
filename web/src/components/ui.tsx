// Small shared pieces: scope switch, page title, breakpoint, error and empty states, skeletons.
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { useApp } from '../app/AppContext';
import type { Scope } from '../lib/types';
import { Icon, type IconName } from './Icon';

const SCOPES: { id: Scope; label: string; icon: IconName }[] = [
  { id: 'alles', label: 'Alles', icon: 'grid' },
  { id: 'persoonlijk', label: 'Persoonlijk', icon: 'person' },
  { id: 'gedeeld', label: 'Gedeeld', icon: 'people' },
];

/** Segmented scope switch Alles · Persoonlijk · Gedeeld: a filter on accounts (analysis/concepts/scope.md). */
export function ScopeSwitch({ className, style }: { className?: string; style?: CSSProperties }) {
  const { scope, setScope } = useApp();
  return (
    <div className={'scope' + (className ? ' ' + className : '')} style={style} role="group" aria-label="Welke rekeningen">
      {SCOPES.map((s) => (
        <button key={s.id} type="button" className="scope-btn" data-scope={s.id} aria-pressed={scope === s.id} onClick={() => setScope(s.id)}>
          <Icon name={s.icon} size={16} stroke={2.2} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title + ' · Saldo';
  }, [title]);
}

const DESKTOP = '(min-width: 1024px)';

function subscribe(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const snapshot = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP).matches : false);

/** True from 1024 px (sidebar layout). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** `style={delay(40)}` for the staggered entry animation (`--d`). */
export const delay = (ms: number) => ({ '--d': ms + 'ms' }) as CSSProperties;

export function ErrorState({ message, onRetry, title = 'Laden lukt niet' }: { message: string; onRetry: () => void; title?: string }) {
  return (
    <section className="state-card anim-in" role="alert">
      <span className="state-icon state-icon--err" aria-hidden="true">
        <Icon name="warning" size={24} stroke={2.2} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      <button type="button" className="btn btn--secondary" onClick={onRetry}>
        <Icon name="sync" size={18} stroke={2.2} />
        Opnieuw proberen
      </button>
    </section>
  );
}

export function Skel({ w, h, round, className }: { w: number | string; h: number; round?: boolean; className?: string }) {
  return <span className={'skel' + (round ? ' skel--round' : '') + (className ? ' ' + className : '')} style={{ width: w, height: h }} />;
}

/** A row-shaped skeleton list inside a card. */
export function SkelList({ rows = 3, label = 'Laden' }: { rows?: number; label?: string }) {
  return (
    <div className="list skel-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="row" key={i}>
          <Skel w={36} h={36} round />
          <span className="skel-lines">
            <Skel w={['58%', '46%', '64%', '52%'][i % 4]} h={13} />
            <Skel w={['38%', '30%', '42%', '34%'][i % 4]} h={10} />
          </span>
          <Skel w={72} h={13} />
        </div>
      ))}
    </div>
  );
}
