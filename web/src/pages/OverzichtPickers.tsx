// The two pickers of Overzicht (plan 0.7-4): the account filter and the custom range.
// Design: finance-mockup/js/screens/overzicht.js (`accountsInner`, `eigenInner`, `pickMonth`). A modal Sheet on the phone,
// an anchored popover from 1024 px; Overzicht owns what is open, where focus returns and what the choice writes to the URL.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useIsDesktop } from '../components/ui';
import { accColour, accountIcon, isShared, others } from '../lib/accounts';
import { MONTHS, MONTHS_SHORT, names } from '../lib/format';
import { monthIndex, monthKey, monthState, monthTitle, pickMonth, presets, rangeStatus, type Draft } from '../lib/reports';
import type { Account, Scope } from '../lib/types';

export type PanelKind = 'eigen' | 'accounts';

const LABEL: Record<PanelKind, string> = { eigen: 'Eigen periode', accounts: 'Rekening kiezen' };
const SCOPE_MENU: Record<Scope, string> = { alles: 'Alle rekeningen die je ziet', persoonlijk: 'Je persoonlijke rekeningen', gedeeld: 'Je gedeelde rekeningen' };

/** Anchored under its trigger by the CSS (it sits inside `.ov-head` or `.ov-tools`); not modal, so no aria-modal. */
function Popover({ label, kind, onClose, children }: { label: string; kind: PanelKind; onClose: (restoreFocus: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    // A click on a trigger is left to the trigger, which toggles; any other click outside closes without moving focus.
    const outside = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || ref.current?.contains(t) || t.closest('[aria-haspopup="dialog"]')) return;
      closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(true);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className={'ov-pop ov-pop--' + kind} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

/** The picker's frame: the popover on desktop, the bottom sheet on the phone. `onClose(true)` returns focus to the trigger. */
export function Panel({ kind, onClose, children }: { kind: PanelKind; onClose: (restoreFocus: boolean) => void; children: ReactNode }) {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Popover kind={kind} label={LABEL[kind]} onClose={onClose}>
        {children}
      </Popover>
    );
  }
  return (
    <Sheet onClose={() => onClose(true)} label={LABEL[kind]} className="ov-sheet">
      <div className="ov-panel-body">{children}</div>
    </Sheet>
  );
}

function PanelHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div className="ov-panel-head">
      <div className="ov-panel-title">
        <h2>{title}</h2>
        <span>{sub}</span>
      </div>
      <button type="button" className="ov-close" aria-label="Sluiten" onClick={onClose}>
        <Icon name="close" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

// ---------- Account filter ----------

/** Only the current accounts of the scope: money sent to a savings account counts as saved. `picked`: the chosen account id. */
export function AccountPicker({ scope, accounts, picked, onPick, onClose }: { scope: Scope; accounts: Account[]; picked: number | undefined; onPick: (id: number | null) => void; onClose: () => void }) {
  const opt = (id: number | null, lead: ReactNode, name: string, sub: string) => {
    const on = picked === (id ?? undefined);
    return (
      <button key={id ?? 'all'} type="button" className="ov-opt" aria-pressed={on} data-autofocus={on || undefined} onClick={() => onPick(id)}>
        {lead}
        <span className="ov-opt-main">
          <span className="ov-opt-name">{name}</span>
          <span className="ov-opt-sub">{sub}</span>
        </span>
        <span className="ov-opt-check">{on && <Icon name="check" size={18} stroke={2.6} />}</span>
      </button>
    );
  };
  return (
    <>
      <PanelHead title="Rekening" sub={SCOPE_MENU[scope]} onClose={onClose} />
      <div className="ov-opts" role="group" aria-label="Rekening">
        {opt(
          null,
          <span className="ov-opt-icon ov-opt-icon--all">
            <Icon name="grid" size={17} stroke={2.2} />
          </span>,
          'Alle rekeningen',
          accounts.length > 1 ? accounts.length + ' rekeningen · samen, ter info' : accounts.map((a) => a.name).join(''),
        )}
        {accounts.map((a) =>
          opt(
            a.id,
            <span className="ov-opt-icon" style={{ background: accColour(a.colour), color: 'var(--onAcc)' }}>
              <Icon name={accountIcon(a)} size={17} stroke={2.2} />
            </span>,
            a.name,
            isShared(a) ? 'Gedeeld' + (others(a).length ? ' · met ' + names(others(a).map((m) => m.name)) : '') : 'Persoonlijk · alleen jij',
          ),
        )}
      </div>
      <p className="ov-pick-note">
        <Icon name="info" size={15} stroke={2.2} />
        <span>Spaarrekeningen staan er niet bij: wat je erheen overschrijft, telt als gespaard.</span>
      </p>
    </>
  );
}

// ---------- Custom range ----------

/** `initial`: the range now shown (`YYYY-MM`). The draft is the picker's own state: closing it throws the draft away. */
export function RangePicker({
  firstMonth,
  today,
  initial,
  onApply,
  onClose,
}: {
  firstMonth: string;
  today: string;
  initial: { from: string; to: string };
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => ({ from: monthIndex(initial.from), to: monthIndex(initial.to), target: 'from' }));
  const firstYear = Math.floor(monthIndex(firstMonth) / 12);
  const years = Array.from({ length: Math.floor(monthIndex(today.slice(0, 7)) / 12) - firstYear + 1 }, (_, k) => firstYear + k);

  const end = (k: 'from' | 'to', label: string, i: number) => (
    <button type="button" className="ov-end" aria-pressed={d.target === k} data-autofocus={k === 'from' || undefined} onClick={() => setD({ ...d, target: k })}>
      <span className="ov-end-label">{label}</span>
      <span className="ov-end-value">{monthTitle(i)}</span>
      <span className="visually-hidden">{d.target === k ? ', de volgende maand die je kiest' : ', kies om te wijzigen'}</span>
    </button>
  );
  const month = (y: number, mi: number) => {
    const i = y * 12 + mi;
    const name = MONTHS[mi] + ' ' + y;
    const state = monthState(monthKey(i), firstMonth, today);
    if (state !== 'ok') {
      return (
        <button key={mi} type="button" className="ov-month" disabled aria-label={name + (state === 'future' ? ', nog niet' : ', geen gegevens')}>
          {MONTHS_SHORT[mi]}
        </button>
      );
    }
    const cls = i === d.from || i === d.to ? ' is-end' : i > d.from && i < d.to ? ' is-in' : '';
    return (
      <button key={mi} type="button" className={'ov-month' + cls} aria-pressed={i >= d.from && i <= d.to} aria-label={name} onClick={() => setD(pickMonth(d, i))}>
        {MONTHS_SHORT[mi]}
      </button>
    );
  };

  return (
    <>
      <PanelHead title="Eigen periode" sub="Kies de eerste en de laatste maand" onClose={onClose} />
      <div className="ov-ends">
        {end('from', 'Van', d.from)}
        {end('to', 'Tot en met', d.to)}
      </div>
      <div className="ov-presets" role="group" aria-label="Snel kiezen">
        {presets(firstMonth, today).map((p) => (
          <button key={p.label} type="button" className="filter-chip ov-preset" aria-pressed={p.from === d.from && p.to === d.to} onClick={() => setD({ from: p.from, to: p.to, target: 'from' })}>
            {p.label}
          </button>
        ))}
      </div>
      {years.map((y) => (
        <div className="ov-year" key={y}>
          <span className="ov-year-label" id={'ov-y-' + y}>
            {y}
          </span>
          <div className="ov-months" role="group" aria-labelledby={'ov-y-' + y}>
            {Array.from({ length: 12 }, (_, mi) => month(y, mi))}
          </div>
        </div>
      ))}
      <p className="ov-pick-note">
        <Icon name="info" size={15} stroke={2.2} />
        <span>
          Gegevens vanaf {monthTitle(monthIndex(firstMonth))}. Oudere geschiedenis? <Link to="/importeren">CSV importeren</Link>
        </span>
      </p>
      <p className="ov-pick-status" role="status">
        {rangeStatus(d.from, d.to, today)}
      </p>
      <div className="ov-panel-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Annuleren
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onApply(monthKey(d.from), monthKey(d.to))}>
          Toepassen
        </button>
      </div>
    </>
  );
}
