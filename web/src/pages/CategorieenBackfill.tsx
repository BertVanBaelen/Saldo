// "Geschiedenis toepassen" (phase 0.5-6): the groups Saldo would categorise from what it learned, previewed first;
// only the groups the user ticks are applied, and only rows that have no category yet.
import { useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { api, errorMessage, isAbort } from '../lib/api';
import { catColours, plural } from '../lib/categories';
import { categoryIcon } from '../lib/categoryIcons';
import { dateShort, eur } from '../lib/format';
import type { BackfillPreview, BackfillResult } from '../lib/types';

interface Props {
  onClose: () => void;
  /** The apply went through. */
  onDone: (r: BackfillResult) => void;
}

export function BackfillSheet({ onClose, onDone }: Props) {
  const { online } = useApp();
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setPreview(null);
    setError('');
    api.backfillPreview(ctl.signal).then(
      (p) => {
        setPreview(p);
        // High certainty is ticked, low is not: low only ever happens on the user's own say.
        setChecked(new Set(p.groups.filter((g) => g.level === 'high').map((g) => g.counterpartyKey)));
      },
      (e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      },
    );
    return () => ctl.abort();
  }, [tries]);

  const picked = preview?.groups.filter((g) => checked.has(g.counterpartyKey)) ?? [];
  const rows = picked.reduce((n, g) => n + g.rows, 0);
  const over = !!preview && (rows > preview.limit || picked.length > preview.groupLimit);

  const toggle = (key: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (!n.delete(key)) n.add(key);
      return n;
    });

  const apply = () => {
    if (!online || busy || !preview || !picked.length || over) return;
    setBusy(true);
    setError('');
    api.applyBackfill(picked.map((g) => ({ counterpartyKey: g.counterpartyKey, categoryId: g.category.id }))).then(onDone, (e) => {
      setError(errorMessage(e));
      setBusy(false);
    });
  };

  return (
    <Sheet onClose={onClose} labelledBy="ct-bf-h" className="ct-sheet" backdropClassName="ct-backdrop">
      <div className="ct-editor">
        <div className="ct-ed-head">
          <span className="ct-ed-icon ct-bf-icon" aria-hidden="true">
            <Icon name="spark" size={20} stroke={2.2} />
          </span>
          <span className="ct-ed-title">
            <h2 className="ct-ed-name" id="ct-bf-h">
              Geschiedenis toepassen
            </h2>
            <span className="ct-ed-sub">Transacties zonder categorie, volgens wat Saldo leerde</span>
          </span>
          <button type="button" className="ct-close" aria-label="Sluiten" onClick={onClose}>
            <Icon name="close" size={18} stroke={2.4} />
          </button>
        </div>
        <p className="ct-box">
          Je ziet eerst wat er zou gebeuren. Er wordt niets overschreven: alleen transacties zonder categorie krijgen er een, en je kan die op elke transactie nog aanpassen. Groepen met hoge zekerheid staan aangevinkt, de andere kies je zelf.
        </p>
        {!preview && !error && <p className="ct-help">Even kijken wat er zou veranderen…</p>}
        {preview && !preview.groups.length && <p className="ct-box">Er zijn geen voorstellen voor transacties zonder categorie.</p>}
        {preview && preview.groups.length > 0 && (
          <ul className="ct-bf-list">
            {preview.groups.map((g) => {
              const lk = catColours(g.category.colour);
              const id = 'ct-bf-' + g.counterpartyKey;
              return (
                <li key={g.counterpartyKey}>
                  <label className="ct-check ct-bf-group" htmlFor={id}>
                    <input id={id} type="checkbox" checked={checked.has(g.counterpartyKey)} disabled={busy} onChange={() => toggle(g.counterpartyKey)} />
                    <span className="ct-bf-main">
                      <strong>{g.counterparty}</strong>
                      <span className="ct-bf-line">
                        <span className="ct-chip" style={{ background: lk.bg, color: lk.fg }}>
                          <Icon name={categoryIcon(g.category.icon)} size={13} stroke={2.4} className="ct-chip-ico" />
                          {g.category.name}
                        </span>
                        <span className={'ct-conf ct-conf--' + (g.level === 'high' ? 'hoog' : 'laag')}>
                          {g.level === 'high' ? 'Hoge zekerheid' : 'Lage zekerheid'} · {g.confidence}&nbsp;%
                        </span>
                      </span>
                      <span className="ct-bf-sub">
                        {plural(g.rows, 'transactie', 'transacties')}
                        {g.examples.length > 0 && ' · bv. ' + g.examples.map((e) => dateShort(e.date) + ' ' + eur(e.amount)).join(', ')}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {preview && preview.groups.length > 0 && (
          <p className={'ct-preview' + (over ? ' ct-preview--bad' : '')} role="status">
            <Icon name={over ? 'warning' : 'info'} size={18} stroke={2.2} />
            <span>
              {over
                ? 'Dat zijn te veel in één keer. Kies hoogstens ' + preview.groupLimit + ' groepen en ' + preview.limit + ' transacties.'
                : plural(rows, 'transactie krijgt', 'transacties krijgen') + ' een categorie, ' + (preview.rows + preview.left - rows) + ' blijven zonder.'}
            </span>
          </p>
        )}
        {error && (
          <p className="ct-form-err" role="alert">
            {error}
          </p>
        )}
        {!online && (
          <p className="ct-offline">
            <Icon name="cloudOff" size={16} stroke={2.2} />
            <span>Je bent offline. Toepassen kan weer zodra je verbinding hebt.</span>
          </p>
        )}
        <div className="ct-actions">
          <button type="button" className="ct-btn ct-btn--ghost" onClick={onClose}>
            Annuleren
          </button>
          {error && !preview ? (
            <button type="button" className="ct-btn ct-btn--primary" onClick={() => setTries((n) => n + 1)}>
              Opnieuw proberen
            </button>
          ) : (
            <button type="button" className="ct-btn ct-btn--primary" disabled={!online || busy || !preview || !picked.length || over} aria-busy={busy || undefined} onClick={apply}>
              Toepassen
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
