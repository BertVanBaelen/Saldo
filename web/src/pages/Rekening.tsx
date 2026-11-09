// Rekening: the page of one account (/rekeningen/:id). Balance and state against its own buffer, balance history,
// "Saldo bijwerken" (manual accounts), recent transactions, Synchronisatie (bank accounts: source, consent,
// re-authorise, remove the link), Instellen (the Rekeningen form) and deleting a manual account.
// Design: finance-mockup/js/screens/rekening.js; spec: analysis/screens/rekeningen.md, analysis 4.8 and 6.3.
// Leden and contributions arrive with shared accounts in 0.6.
import { useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, Skel, SkelList, useTitle } from '../components/ui';
import { accColour, accountState, isCurrent, isShared, manager, others, STATE_CHIP, staleNote, syncLine } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { dateRelative, dateShort, dateYear, eur, momentLabel, names, parseMoney, toDate } from '../lib/format';
import type { Account, BalancePoint, Connection, Transaction } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { amountClass, catView } from './Transacties';
import { Avatar, Editor, patchOf, values, type Draft } from './Rekeningen';
import './Rekeningen.css';
import './Rekening.css';

/** The state of a current account against its own buffer, in words (as the mockup's bufferState). */
export function bufferText(a: Account): string {
  const whose = isShared(a) ? 'de' : 'je';
  if (a.balance < 0) return eur(-a.balance) + ' onder nul · ' + whose + ' buffer is ' + eur(a.buffer);
  if (a.balance < a.buffer) return eur(a.buffer - a.balance) + ' onder ' + whose + ' buffer van ' + eur(a.buffer);
  return eur(a.balance - a.buffer) + ' boven ' + whose + ' buffer van ' + eur(a.buffer);
}

const TONE = { ok: 'ok', buffer: 'warn', neg: 'neg' } as const;

function CardHead({ id, title, meta, extra }: { id: string; title: string; meta?: string; extra?: React.ReactNode }) {
  return (
    <div className="rkd-card-head">
      <span className="rkd-card-titles">
        <h2 className="rkd-card-title" id={id}>
          {title}
        </h2>
        {meta && <span className="rkd-card-meta">{meta}</span>}
      </span>
      {extra}
    </div>
  );
}

// ---------- Header ----------

function Hero({ a, today }: { a: Account; today: string }) {
  const manual = a.source === 'manual';
  const s = syncLine(a, today);
  const stale = staleNote(a, today);
  const st = isCurrent(a) ? accountState(a) : null;
  return (
    <section className="rkd-hero anim-in" style={delay(20)} aria-labelledby="rkd-name">
      <div className="rkd-hero-id">
        <Avatar a={a} size={22} />
        <span className="rkd-hero-names">
          <h1 className="rkd-name" id="rkd-name">
            {a.name}
          </h1>
          {a.iban ? <span className="mono rkd-iban">{a.iban}</span> : <span className="rkd-iban rkd-iban--none">Geen IBAN</span>}
        </span>
      </div>
      <div className="rkd-kinds">
        {isShared(a) ? (
          <span className="rkd-kind rkd-kind--ged">
            <Icon name="people" size={14} stroke={2.2} />
            Gedeeld · met {names(others(a).map((m) => m.name))}
          </span>
        ) : (
          <span className="rkd-kind rkd-kind--pers">
            <Icon name="person" size={14} stroke={2.2} />
            Persoonlijk · alleen jij
          </span>
        )}
        <span className="rkd-kind">
          {(a.type === 'savings' ? 'Spaarrekening' : 'Zichtrekening') + ' · ' + (manual ? 'handmatig' : a.bank || 'bank')}
        </span>
        {a.permission === 'read' && (
          <span className="chip chip--readonly rkd-ro-chip">
            <Icon name="lock" size={13} stroke={2.2} />
            Alleen lezen
          </span>
        )}
      </div>
      <div className="rkd-hero-bal">
        <span className="rkd-bal-label">{manual ? 'Saldo · handmatig' : 'Saldo nu'}</span>
        <span className={'mono rkd-bal' + (a.balance < 0 ? ' neg' : '')}>{eur(a.balance)}</span>
        {st ? (
          <span className="rkd-state">
            <span className={'chip chip--' + TONE[st]}>{STATE_CHIP[st]}</span>
            <span className="rkd-state-text">{bufferText(a)}</span>
          </span>
        ) : (
          <span className="rkd-state">
            <span className="chip rkd-chip-plain">Telt niet mee in de planning</span>
            <span className="rkd-state-text">Spaarrekeningen hebben geen buffer</span>
          </span>
        )}
        <span className={'rkd-sync' + (s.tone ? ' rkd-sync--' + s.tone : '')}>
          <Icon name={manual ? 'edit' : s.tone === 'neg' ? 'warning' : s.tone ? 'clock' : 'sync'} size={14} stroke={2.2} />
          <span>{manual ? 'Handmatig · ' + (a.balanceDate ? 'bijgewerkt op ' + dateYear(a.balanceDate) : 'nog geen saldo') : stale ? s.text + ' · ' + stale.toLowerCase() : s.text}</span>
        </span>
      </div>
    </section>
  );
}

function SyncAlert({ a, today }: { a: Account; today: string }) {
  if (a.source !== 'bank' || a.syncStatus === 'ok') return null;
  const stale = staleNote(a, today);
  const [kind, icon, title, note] =
    a.syncStatus === 'unlinked'
      ? (['warn', 'link', 'Niet meer gekoppeld', 'Saldo werkt deze rekening niet meer bij. Koppel je bank opnieuw om verder te gaan.'] as const)
      : a.syncStatus === 'failed'
        ? (['neg', 'warning', 'Synchronisatie mislukt · ' + (a.bank || 'de bank'), (stale ? 'Je ziet de ' + stale.toLowerCase() + '. ' : '') + 'Bekijk de synchronisatie.'] as const)
        : (['warn', 'sync', a.lastSync ? 'Niet bijgewerkt sinds ' + momentLabel(a.lastSync, today) : 'Nog niet gesynchroniseerd', 'Het saldo kan afwijken. Bekijk de synchronisatie.'] as const);
  return (
    <a className={'alert alert--' + kind + ' rkd-alert anim-in'} style={delay(40)} href="#synchronisatie">
      <span className="alert-icon">
        <Icon name={icon} size={17} stroke={2.2} />
      </span>
      <span className="alert-text">
        <strong>{title}</strong>
        <br />
        <span>{note}</span>
      </span>
      <span className="rkd-chev">
        <Icon name="chevron" size={18} />
      </span>
    </a>
  );
}

// ---------- Saldoverloop ----------

const DAY = 86400000;
const dayNo = (d: string) => Math.round(toDate(d).getTime() / DAY);

/** The plotted points: a bank account's last six months, every manual update. */
export function historyPoints(a: Account, points: BalancePoint[], today: string): BalancePoint[] {
  if (a.source === 'manual') return points;
  const from = dayNo(today) - 183;
  return points.filter((p) => dayNo(p.date) >= from);
}

/** Calendar days under the buffer: a balance holds until the date of the next point, the last one through today. */
function daysUnder(list: BalancePoint[], buffer: number, today: string): number {
  let days = 0;
  list.forEach((p, i) => {
    if (p.balance < buffer) days += (i + 1 < list.length ? dayNo(list[i + 1].date) : dayNo(today) + 1) - dayNo(p.date);
  });
  return days;
}

function Chart({ a, points, today }: { a: Account; points: BalancePoint[]; today: string }) {
  const W = 600;
  const H = 150;
  const manual = a.source === 'manual';
  const buffer = isCurrent(a) ? a.buffer : null;
  const vals = points.map((p) => p.balance);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (buffer !== null) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, buffer);
  }
  const pad = Math.max((hi - lo) * (manual ? 0.35 : 0.08), 2000);
  lo -= pad;
  hi += pad;
  const d0 = dayNo(points[0].date);
  const d1 = Math.max(dayNo(today), d0 + 1);
  const X = (d: string) => 4 + ((dayNo(d) - d0) / (d1 - d0)) * (W - 8);
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const ink = 'var(--acc)';
  let line = '';
  points.forEach((p, i) => {
    if (!i) line = 'M' + X(p.date) + ' ' + Y(p.balance);
    else if (manual) line += ' H' + X(p.date) + ' V' + Y(p.balance);
    else line += ' L' + X(p.date) + ' ' + Y(p.balance);
  });
  const last = points[points.length - 1];
  const end = X(today);
  return (
    <svg className="rkd-svg" viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
      {buffer !== null && Y(0) < H && <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} style={{ stroke: 'var(--muted)', strokeWidth: 1.5 }} vectorEffect="non-scaling-stroke" />}
      {buffer !== null && buffer > 0 && (
        <line x1={0} x2={W} y1={Y(buffer)} y2={Y(buffer)} style={{ stroke: 'var(--muted)', strokeWidth: 1.5, strokeDasharray: '4 4' }} vectorEffect="non-scaling-stroke" />
      )}
      <path d={line + ' L' + X(last.date) + ' ' + H + ' L' + X(points[0].date) + ' ' + H + ' Z'} style={{ fill: ink, opacity: 0.1 }} />
      <path d={line} fill="none" style={{ stroke: ink, strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' }} vectorEffect="non-scaling-stroke" />
      {end > X(last.date) && (
        <path d={'M' + X(last.date) + ' ' + Y(last.balance) + ' H' + end} fill="none" style={{ stroke: ink, strokeWidth: 2.5, strokeDasharray: '5 5' }} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function HistoryCard({ a, points, error, onRetry, today }: { a: Account; points: BalancePoint[] | undefined; error: string | null; onRetry: () => void; today: string }) {
  const manual = a.source === 'manual';
  const list = points ? historyPoints(a, points, today) : [];
  let body;
  if (!points) body = error ? <ErrorState message={error} onRetry={onRetry} /> : <Skel w="100%" h={150} />;
  else if (!list.length) {
    body = (
      <div className="rkd-empty">
        <p>{manual ? 'Nog geen saldo. Vul het saldo in bij Saldo bijwerken.' : 'Nog geen saldo van de bank. Het komt binnen met de volgende synchronisatie.'}</p>
      </div>
    );
  } else {
    const last = list[list.length - 1];
    let stats;
    if (manual) {
      const growth = last.balance - list[0].balance;
      stats = [
        { label: 'Sinds ' + dateShort(list[0].date), value: eur(growth, true), color: growth >= 0 ? 'var(--greenText)' : 'var(--neg)' },
        { label: 'Updates', value: String(list.length) },
        { label: 'Laatste update', value: dateShort(last.date) },
      ];
    } else {
      const low = list.reduce((m, p) => (p.balance < m.balance ? p : m));
      const high = list.reduce((m, p) => (p.balance > m.balance ? p : m));
      const under = isCurrent(a) ? daysUnder(list, a.buffer, today) : 0;
      stats = [
        { label: 'Laagste · ' + dateShort(low.date), value: eur(low.balance), color: low.balance < 0 ? 'var(--neg)' : undefined },
        { label: 'Hoogste · ' + dateShort(high.date), value: eur(high.balance) },
        isCurrent(a) ? { label: 'Onder de buffer', value: under + (under === 1 ? ' dag' : ' dagen'), color: under ? 'var(--warn)' : undefined } : { label: 'Dagen', value: String(list.length) },
      ];
    }
    body = (
      <>
        <div className="rkd-readout">
          <span className="rkd-readout-date">{(last.date === today ? 'Vandaag' : 'Laatste stand') + ' · ' + dateYear(last.date)}</span>
          <span className="mono rkd-readout-amount">{eur(last.balance)}</span>
        </div>
        {list.length > 1 ? (
          <div className="rkd-plot">
            <Chart a={a} points={list} today={today} />
          </div>
        ) : (
          <div className="rkd-empty">
            <p>{manual ? 'Na je volgende update zie je hier hoe het saldo verloopt.' : 'Na een paar synchronisaties zie je hier hoe het saldo verloopt.'}</p>
          </div>
        )}
        <div className="rkd-stats">
          {stats.map((s) => (
            <span className="rkd-stat" key={s.label}>
              <span className="rkd-stat-label">{s.label}</span>
              <span className="mono rkd-stat-value" style={s.color ? { color: s.color } : undefined}>
                {s.value}
              </span>
            </span>
          ))}
        </div>
        <div className="legend rkd-legend">
          {manual ? (
            <span>
              <i className="rkd-key-dash" style={{ borderColor: 'var(--acc)' }} />
              Nog niet bijgewerkt
            </span>
          ) : (
            isCurrent(a) && (
              <>
                <span>
                  <i className="rkd-key-dash" />
                  Buffer {eur(a.buffer)}
                </span>
                <span>
                  <i className="rkd-key-zero" />€ 0
                </span>
              </>
            )
          )}
        </div>
      </>
    );
  }
  return (
    <section className="card rkd-card anim-in" style={delay(60)} id="saldoverloop" aria-labelledby="rkd-h-hist">
      <CardHead
        id="rkd-h-hist"
        title="Saldoverloop"
        meta={manual ? (a.balanceDate ? 'Handmatig · bijgewerkt op ' + dateYear(a.balanceDate) : 'Handmatig') : 'Laatste 6 maanden · saldo per dag'}
      />
      {body}
    </section>
  );
}

// ---------- Saldo bijwerken (manual accounts) ----------

function UpdateCard({ a, points, onSaved }: { a: Account; points: BalancePoint[]; onSaved: (a: Account) => void }) {
  const { today, online, toast } = useApp();
  const ro = a.permission === 'read';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<{ amount?: string; date?: string; save?: string }>({});
  const [saving, setSaving] = useState(false);
  const save = () => {
    const v = parseMoney(amount);
    const e: typeof err = {};
    if (!amount.trim() || isNaN(v)) e.amount = 'Vul het saldo in, bijvoorbeeld 12.900,00.';
    if (!date || date > today) e.date = 'Kies vandaag of een dag in het verleden.';
    setErr(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    api.setBalance(a.id, v, date).then(
      (x) => {
        setSaving(false);
        setAmount('');
        setDate(today);
        toast('Saldo bijgewerkt · ' + eur(v));
        onSaved(x);
      },
      (x) => {
        setSaving(false);
        setErr({ save: errorMessage(x) });
      },
    );
  };
  const rows = points.slice().reverse();
  return (
    <section className="card rkd-card anim-in" style={delay(80)} id="bijwerken" aria-labelledby="rkd-h-upd">
      <CardHead id="rkd-h-upd" title="Saldo bijwerken" meta={a.balanceDate ? 'Laatst bijgewerkt op ' + dateYear(a.balanceDate) : 'Nog niet bijgewerkt'} />
      <div className="rkd-upd-form">
        <div className="rk-field rk-field--tight">
          <label className="rk-label" htmlFor="rkd-upd-amount">
            Saldo
          </label>
          <div className="rk-money">
            <span aria-hidden="true">€</span>
            <input
              className={'input rk-money-input rk-money-input--left' + (err.amount ? ' rk-input--err' : '')}
              id="rkd-upd-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={a.balanceDate ? eur(a.balance).replace('€ ', '') : '0,00'}
              value={amount}
              disabled={ro}
              aria-invalid={err.amount ? true : undefined}
              aria-describedby={err.amount ? 'rkd-upd-amount-err' : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {err.amount && (
            <span className="rk-err" id="rkd-upd-amount-err">
              {err.amount}
            </span>
          )}
        </div>
        <div className="rk-field rk-field--tight">
          <label className="rk-label" htmlFor="rkd-upd-date">
            Datum
          </label>
          <input
            className={'input rkd-date' + (err.date ? ' rk-input--err' : '')}
            type="date"
            id="rkd-upd-date"
            max={today}
            value={date}
            disabled={ro}
            aria-invalid={err.date ? true : undefined}
            aria-describedby={err.date ? 'rkd-upd-date-err' : undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          {err.date && (
            <span className="rk-err" id="rkd-upd-date-err">
              {err.date}
            </span>
          )}
        </div>
        <button type="button" className="btn btn--primary rkd-upd-save" disabled={!online || ro || saving} onClick={save}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
      {err.save && (
        <p className="rk-err rk-save-err" role="alert">
          {err.save}
        </p>
      )}
      {!online && (
        <p className="rk-offline">
          <Icon name="cloudOff" size={14} stroke={2.2} />
          Je bent offline. Bijwerken kan weer zodra je verbinding hebt.
        </p>
      )}
      {rows.length > 0 && (
        <div className="rkd-sub">
          <h3 className="label rkd-sub-label">Geschiedenis</h3>
          <ul className="rkd-upd-list">
            {rows.map((p, i) => {
              const prev = rows[i + 1];
              const diff = prev ? p.balance - prev.balance : null;
              return (
                <li className="rkd-upd-row" key={p.date}>
                  <span className="rkd-upd-date">{dateYear(p.date)}</span>
                  <span className="mono rkd-upd-amount">{eur(p.balance)}</span>
                  <span className={'mono rkd-upd-diff' + (diff === null ? ' muted' : diff >= 0 ? ' pos' : ' neg')}>{diff === null ? 'begin' : eur(diff, true)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------- Recent transactions ----------

function TxCard({ a, page, error, onRetry, today }: { a: Account; page: Transaction[] | undefined; error: string | null; onRetry: () => void; today: string }) {
  const link = (
    <Link className="section-link rkd-all" to={'/transacties?rekening=' + a.id}>
      Alle transacties
      <Icon name="chevron" size={16} stroke={2.2} />
    </Link>
  );
  let body;
  if (!page) body = error ? <ErrorState message={error} onRetry={onRetry} /> : <SkelList rows={3} label="Transacties laden" />;
  else if (!page.length) {
    body = (
      <div className="rkd-empty">
        <p>
          {a.source === 'manual'
            ? 'Een handmatige rekening heeft geen eigen transacties. Overschrijvingen ernaar zie je op de rekening waar ze vertrekken' +
              (a.iban ? '; Saldo herkent ze aan dit IBAN.' : '. Vul het IBAN in bij Instellen, dan herkent Saldo ze als overschrijving.')
            : 'Nog geen transacties. Ze komen binnen met de volgende synchronisatie.'}
        </p>
      </div>
    );
  } else {
    body = (
      <ul className="rkd-txs">
        {page.map((t) => {
          const cv = catView(t);
          return (
            <li className="rkd-tx" key={t.id}>
              {cv.uncat ? (
                <span className="rkd-tx-av rkd-tx-av--uncat" aria-hidden="true">
                  ?
                </span>
              ) : cv.transfer && !t.category ? (
                <span className="rkd-tx-av" style={{ background: 'var(--bg)', color: 'var(--text)' }} aria-hidden="true">
                  <Icon name="transfer" size={16} stroke={2.2} />
                </span>
              ) : (
                <span className="rkd-tx-av" style={{ background: cv.bg, color: cv.fg }} aria-hidden="true">
                  {(t.counterparty.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase()}
                </span>
              )}
              <span className="rkd-tx-main">
                <span className="rkd-tx-name">{t.counterparty}</span>
                <span className="rkd-tx-sub">{cv.name + ' · ' + dateRelative(t.bookingDate, today)}</span>
              </span>
              <span className="rkd-tx-end">
                <span className={'mono rkd-tx-amount ' + amountClass(t)}>{eur(t.amount, true)}</span>
                {t.status === 'pending' && <span className="rkd-pending">In behandeling</span>}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section className="card rkd-card anim-in" style={delay(100)} id="transacties" aria-labelledby="rkd-h-tx">
      <CardHead id="rkd-h-tx" title="Recente transacties" extra={page?.length ? link : undefined} />
      {body}
    </section>
  );
}

// ---------- Synchronisatie (bank accounts) ----------

function SyncCard({ a, conn, onRemove }: { a: Account; conn: Connection | undefined; onRemove: () => void }) {
  const { today, online, syncing, startSync } = useApp();
  const mgr = manager(a);
  const syncBtn = (
    <button
      type="button"
      className="icon-btn rkd-sync-btn"
      aria-label={!online ? 'Synchroniseren kan niet: je bent offline' : syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren'}
      aria-disabled={!online || undefined}
      onClick={startSync}
    >
      <span className={syncing ? 'spin' : ''} style={{ display: 'flex' }}>
        <Icon name="sync" size={20} stroke={2.2} />
      </span>
    </button>
  );

  if (a.syncStatus === 'unlinked') {
    return (
      <section className="card rkd-card anim-in" style={delay(70)} id="synchronisatie" aria-labelledby="rkd-h-sync">
        <CardHead id="rkd-h-sync" title="Synchronisatie" />
        <div className="rkd-sync-status rkd-sync-status--warn">
          <span className="rkd-sync-status-icon">
            <Icon name="link" size={16} stroke={2.4} />
          </span>
          <span className="rkd-sync-status-text">
            <strong>Niet meer gekoppeld</strong>
            <small>{a.balanceDate ? 'Laatste saldo van ' + dateYear(a.balanceDate) : 'Geen saldo van de bank'}</small>
          </span>
        </div>
        <p className="rkd-help">De koppeling is verwijderd, de geschiedenis bleef bewaard. Koppel je bank opnieuw: Saldo herkent de rekening aan haar IBAN en haalt op wat ontbreekt.</p>
        <div className="rkd-actions">
          <Link className="btn btn--primary btn--block" to="/bankkoppelingen/koppelen">
            <Icon name="link" size={18} stroke={2.2} />
            Bank opnieuw koppelen
          </Link>
        </div>
      </section>
    );
  }

  const tone = a.syncStatus === 'failed' ? 'neg' : a.syncStatus === 'stale' ? 'warn' : 'ok';
  const last = a.lastSync ? momentLabel(a.lastSync, today) : null;
  const statusText =
    tone === 'neg'
      ? 'Synchronisatie mislukt' + (a.balanceDate ? ' · stand van ' + dateShort(a.balanceDate) : '')
      : tone === 'warn'
        ? last
          ? 'Niet bijgewerkt sinds ' + last
          : 'Nog niet gesynchroniseerd'
        : 'Laatst gesynchroniseerd ' + last;
  const daysLeft = conn?.daysLeft ?? null;
  const consent = conn?.validUntil ? 'tot ' + dateYear(conn.validUntil) + (daysLeft !== null && daysLeft >= 0 ? ' · nog ' + daysLeft + (daysLeft === 1 ? ' dag' : ' dagen') : ' · verlopen') : 'nog niet bevestigd';
  const chip = conn
    ? conn.status === 'expired'
      ? { tone: 'neg', text: 'Verlopen' }
      : conn.status === 'failed'
        ? { tone: 'neg', text: 'Mislukt' }
        : conn.status === 'stale'
          ? { tone: 'warn', text: 'Verouderd' }
          : conn.status === 'pending'
            ? { tone: 'warn', text: 'Niet afgerond' }
            : { tone: 'ok', text: 'Werkt' }
    : null;
  return (
    <section className="card rkd-card anim-in" style={delay(70)} id="synchronisatie" aria-labelledby="rkd-h-sync">
      <CardHead id="rkd-h-sync" title="Synchronisatie" extra={conn && syncBtn} />
      <div className={'rkd-sync-status rkd-sync-status--' + tone}>
        <span className="rkd-sync-status-icon">
          <Icon name={tone === 'neg' ? 'warning' : tone === 'warn' ? 'clock' : 'check'} size={16} stroke={2.4} />
        </span>
        <span className="rkd-sync-status-text">
          <strong>{statusText}</strong>
          <small>Elke nacht rond 04:00, of nu met de knop.</small>
        </span>
      </div>
      {conn ? (
        <>
          <ul className="rkd-srcs">
            <li className="rkd-src">
              <span className="rkd-src-icon">
                <Icon name="bank" size={18} stroke={2.2} />
              </span>
              <div className="rkd-src-main">
                <div className="rkd-src-top">
                  <span className="rkd-src-title">Jouw koppeling · {conn.bank}</span>
                  <span className="rkd-prio rkd-prio--primary">Primair</span>
                </div>
                <dl className="rkd-facts">
                  <div>
                    <dt>Toestemming</dt>
                    <dd className={daysLeft !== null && daysLeft <= 14 ? 'warn' : undefined}>{consent}</dd>
                  </div>
                  <div>
                    <dt>Laatste sync</dt>
                    <dd>{conn.lastSync ? momentLabel(conn.lastSync, today) : 'nog niet'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{chip && <span className={'chip chip--' + chip.tone + ' rkd-src-chip'}>{chip.text}</span>}</dd>
                  </div>
                </dl>
              </div>
            </li>
          </ul>
          <p className="rkd-help">Alleen jouw koppeling houdt deze rekening bij. Banken vragen elke 180 dagen opnieuw toestemming.</p>
          <div className="rkd-actions">
            {tone !== 'ok' && (
              <button type="button" className="btn btn--primary btn--block" aria-disabled={!online || syncing || undefined} onClick={startSync}>
                <Icon name="sync" size={18} stroke={2.2} />
                Nu opnieuw proberen
              </button>
            )}
            <Link className={'btn btn--block ' + ((daysLeft !== null && daysLeft <= 14) || conn.status === 'expired' ? 'btn--primary' : 'btn--ghost')} to={'/bankkoppelingen/koppelen?koppeling=' + conn.id}>
              <Icon name="shield" size={18} stroke={2.2} />
              Opnieuw autoriseren
            </Link>
            <button type="button" className="btn btn--danger btn--block" aria-haspopup="dialog" onClick={onRemove}>
              <Icon name="trash" size={18} stroke={2.2} />
              Koppeling verwijderen
            </button>
          </div>
        </>
      ) : (
        <p className="rkd-help">{(mgr && !mgr.me ? 'De koppeling van ' + mgr.name : 'Een koppeling van een ander lid') + ' houdt deze rekening bij. Je beheert alleen je eigen koppelingen.'}</p>
      )}
    </section>
  );
}

// ---------- Remove a bank link (analysis 4.8): keep or delete history, delete needs a second step ----------

/** The accounts a removal with "delete" would delete (only you hold them) and keep (others see them). */
export function removalSplit(conn: Connection, accounts: Account[]) {
  const fed = accounts.filter((a) => conn.accounts.includes(a.id));
  return { gone: fed.filter((a) => !isShared(a)), kept: fed.filter(isShared) };
}

export function RemoveLink({ conn, accounts, onClose, onDone }: { conn: Connection; accounts: Account[]; onClose: () => void; onDone: (deleted: number[]) => void }) {
  const { online, toast, refreshShell } = useApp();
  const [choice, setChoice] = useState<'keep' | 'delete'>('keep');
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { gone, kept } = removalSplit(conn, accounts);
  const goneNames = names(gone.map((a) => a.name));
  const keptNames = names(kept.map((a) => a.name));
  const fedNames = names([...gone, ...kept].map((a) => a.name)) || 'je rekeningen';

  const remove = () => {
    setBusy(true);
    setError(null);
    api.removeConnection(conn.id, choice).then(
      (r) => {
        toast(choice === 'keep' ? 'Koppeling verwijderd · geschiedenis bewaard' : 'Koppeling verwijderd · geschiedenis gewist');
        refreshShell();
        onDone(r.deleted);
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };
  const opt = (v: 'keep' | 'delete', title: string, sub: string, disabled = false) => (
    <button
      type="button"
      className="rk-kind"
      role="radio"
      aria-checked={choice === v}
      tabIndex={choice === v ? 0 : -1}
      disabled={disabled}
      onClick={() => setChoice(v)}
      onKeyDown={(e) => {
        if (e.key.startsWith('Arrow') && gone.length) {
          e.preventDefault();
          setChoice(choice === 'keep' ? 'delete' : 'keep');
        }
      }}
    >
      <span className="rk-kind-dot" aria-hidden="true" />
      <span className="rk-kind-main">
        <span className="rk-kind-title">{title}</span>
        <span className="rk-kind-sub">{sub}</span>
      </span>
    </button>
  );
  const head = (title: string, icon: 'link' | 'trash') => (
    <div className="rkd-dlg-head">
      <span className="rkd-dlg-icon">
        <Icon name={icon} size={20} stroke={2.2} />
      </span>
      <h2 className="rkd-dlg-title" id="rkd-dlg-title">
        {title}
      </h2>
      <button type="button" className="rk-close" aria-label="Sluiten" onClick={onClose}>
        <Icon name="close" size={18} stroke={2.4} />
      </button>
    </div>
  );
  const foot = (
    <>
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      {!online && (
        <p className="rk-offline">
          <Icon name="cloudOff" size={14} stroke={2.2} />
          Je bent offline. Verwijderen kan weer zodra je verbinding hebt.
        </p>
      )}
    </>
  );

  return (
    <Sheet onClose={onClose} labelledBy="rkd-dlg-title" className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
      {step === 'choose' ? (
        <>
          {head('Koppeling met ' + conn.bank + ' verwijderen?', 'link')}
          <p className="rkd-dlg-text">
            Saldo leest {fedNames} dan niet meer via jouw {conn.bank}-koppeling, en de toestemming en je sleutel worden gewist. Wil je later opnieuw koppelen, dan vul je de sleutel van je Enable
            Banking-app opnieuw in.
          </p>
          <div className="rk-field">
            <span className="rk-label" id="rkd-dlg-hist">
              Geschiedenis
            </span>
            <div className="rk-kinds" role="radiogroup" aria-labelledby="rkd-dlg-hist">
              {opt('keep', 'Geschiedenis bewaren', 'Transacties en saldi blijven, maar de rekeningen worden niet meer bijgewerkt. Koppel je later opnieuw, dan gaan ze verder waar ze stopten.')}
              {opt(
                'delete',
                'Geschiedenis verwijderen',
                gone.length
                  ? goneNames + ' en alle transacties en saldi ervan worden gewist.' + (kept.length ? ' ' + keptNames + ' blijft bestaan voor de andere leden.' : '')
                  : kept.length
                    ? 'Kan niet: ' + keptNames + ' ziet een ander lid nog. Een gedeelde rekening verlaten komt in versie 0.6.'
                    : 'Deze koppeling heeft nog geen rekeningen of geschiedenis.',
                !gone.length,
              )}
            </div>
          </div>
          {foot}
          <div className="rk-actions">
            <button type="button" className="rk-btn rk-btn--ghost" onClick={onClose}>
              Annuleren
            </button>
            {choice === 'keep' ? (
              <button type="button" className="rk-btn rkd-btn--neg" disabled={!online || busy} onClick={remove}>
                {busy ? 'Verwijderen…' : 'Koppeling verwijderen'}
              </button>
            ) : (
              <button type="button" className="rk-btn rkd-btn--neg" disabled={!online} onClick={() => setStep('confirm')}>
                Verder
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {head(goneNames + ' definitief wissen?', 'trash')}
          <div className="rkd-dlg-warn">
            <Icon name="warning" size={18} stroke={2.2} />
            <span>
              {goneNames} en alle transacties, saldi en splitsingen ervan worden gewist. Dit kan je niet ongedaan maken.
            </span>
          </div>
          {kept.length > 0 && <p className="rkd-dlg-text">{keptNames} blijft bestaan voor de andere leden, zonder jouw koppeling.</p>}
          <label className="rkd-check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>Ik begrijp dat deze geschiedenis weg is</span>
          </label>
          {foot}
          <div className="rk-actions">
            <button type="button" className="rk-btn rk-btn--ghost" onClick={() => setStep('choose')}>
              Terug
            </button>
            <button type="button" className="rk-btn rkd-btn--neg" disabled={!online || !sure || busy} onClick={remove}>
              {busy ? 'Verwijderen…' : 'Definitief verwijderen'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function DeleteManual({ a, updates, onClose, onDone }: { a: Account; updates: number; onClose: () => void; onDone: () => void }) {
  const { online, toast, refreshShell } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    setBusy(true);
    api.deleteAccount(a.id).then(
      () => {
        toast(a.name + ' is verwijderd');
        // Its transactions and transfers go: the uncategorised count changes.
        refreshShell();
        onDone();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };
  return (
    <Sheet onClose={onClose} labelledBy="rkd-dlg-title" className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
      <div className="rkd-dlg-head">
        <span className="rkd-dlg-icon">
          <Icon name="trash" size={20} stroke={2.2} />
        </span>
        <h2 className="rkd-dlg-title" id="rkd-dlg-title">
          {a.name} verwijderen?
        </h2>
        <button type="button" className="rk-close" aria-label="Sluiten" onClick={onClose}>
          <Icon name="close" size={18} stroke={2.4} />
        </button>
      </div>
      <p className="rkd-dlg-text">
        De rekening en haar saldogeschiedenis ({updates} {updates === 1 ? 'update' : 'updates'}) worden gewist. Dit kan je niet ongedaan maken.
        {a.iban && ' Overschrijvingen naar ' + a.iban + ' tellen daarna niet meer als overschrijving tussen je eigen rekeningen.'}
      </p>
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      <div className="rk-actions">
        <button type="button" className="rk-btn rk-btn--ghost" onClick={onClose}>
          Annuleren
        </button>
        <button type="button" className="rk-btn rkd-btn--neg" disabled={!online || busy} onClick={remove}>
          {busy ? 'Verwijderen…' : 'Rekening verwijderen'}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- Screen ----------

function Back() {
  return (
    <Link className="rkd-back anim-fade" to="/rekeningen" aria-label="Terug naar Rekeningen">
      <Icon name="back" size={20} stroke={2.4} />
      <span>Rekeningen</span>
    </Link>
  );
}

export function Rekening() {
  const { id: raw } = useParams();
  const id = Number(raw) || 0;
  const { today, toast, dataVersion, refreshShell } = useApp();
  const navigate = useNavigate();
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const a = accounts.data?.find((x) => x.id === id);
  useTitle(a ? a.name : 'Rekening');
  const found = !!a;
  const bank = a?.source === 'bank';
  const balances = useAsync((signal) => (found ? api.balances(id, signal) : Promise.resolve([])), [id, found, dataVersion]);
  const txs = useAsync((signal) => (found ? api.transactions({ account: id, limit: 5 }, signal).then((p) => p.items) : Promise.resolve([])), [id, found, dataVersion]);
  const conns = useAsync((signal) => (bank ? api.connections(signal) : Promise.resolve([] as Connection[])), [bank, dataVersion]);
  const conn = conns.data?.find((c) => c.accounts.includes(id));

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'unlink' | 'delete' | null>(null);

  if (!accounts.data) {
    return (
      <div className="page rkd-page">
        <Back />
        {accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : <SkelList rows={3} label="Rekening laden" />}
      </div>
    );
  }
  if (!a) {
    const empty = accounts.data.length === 0;
    return (
      <div className="page rkd-page">
        <Back />
        <section className="card rk-empty rkd-missing anim-in" style={delay(30)} aria-labelledby="rkd-missing-title">
          <span className="rk-empty-icon" aria-hidden="true">
            <Icon name="card" size={28} stroke={2} />
          </span>
          <h1 className="rk-empty-title" id="rkd-missing-title">
            {empty ? 'Nog geen rekeningen' : 'Deze rekening bestaat niet (meer)'}
          </h1>
          <p className="rk-empty-text">{empty ? 'Koppel je zichtrekening bij de bank of voeg een handmatige rekening toe.' : 'Misschien is ze verwijderd, of heb je er geen toegang meer toe.'}</p>
          <div className="rk-empty-actions">
            <Link className="btn btn--primary" to="/rekeningen">
              Naar Rekeningen
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const replace = (x: Account) => accounts.setData(accounts.data!.map((y) => (y.id === x.id ? x : y)));
  const save = () => {
    const v = values(a, draft);
    if (isNaN(v.buffer) || saving) return;
    const patch = patchOf(a, v);
    if (!Object.keys(patch).length) {
      setDraft({});
      return;
    }
    setSaving(true);
    setError(null);
    api.updateAccount(a.id, patch).then(
      (x) => {
        replace(x);
        setDraft({});
        setSaving(false);
        toast(x.name + ' opgeslagen');
        if ('iban' in patch) refreshShell();
      },
      (e) => {
        setSaving(false);
        setError(errorMessage(e));
      },
    );
  };
  const manual = a.source === 'manual';
  const removed = (deleted: number[]) => {
    setDialog(null);
    if (deleted.includes(a.id)) navigate('/rekeningen', { replace: true });
    else {
      accounts.reload();
      conns.reload();
    }
  };

  return (
    <div className="page rkd-page">
      <Back />
      <div className="rkd-layout" style={{ '--acc': accColour(a.colour) } as CSSProperties}>
        <div className="rkd-head">
          <Hero a={a} today={today} />
          <SyncAlert a={a} today={today} />
        </div>
        <div className="rkd-col rkd-col--main">
          <HistoryCard a={a} points={balances.data} error={balances.error} onRetry={balances.reload} today={today} />
          {manual && a.permission === 'edit' && (
            <UpdateCard
              a={a}
              points={balances.data || []}
              onSaved={(x) => {
                replace(x);
                balances.reload();
              }}
            />
          )}
          <TxCard a={a} page={txs.data} error={txs.error} onRetry={txs.reload} today={today} />
        </div>
        <div className="rkd-col rkd-col--side">
          {bank && <SyncCard a={a} conn={conn} onRemove={() => setDialog('unlink')} />}
          <section className="card rkd-card anim-in" style={delay(90)} id="instellen" aria-labelledby="rkd-h-set">
            <CardHead
              id="rkd-h-set"
              title="Instellen"
              meta={isShared(a) ? 'Naam, kleur en buffer gelden voor alle leden' : 'Naam, kleur' + (isCurrent(a) ? ' en buffer' : '') + (manual ? ' en IBAN' : '')}
            />
            <Editor
              a={a}
              bare
              draft={draft}
              setDraft={(d) => {
                setDraft(d);
                setError(null);
              }}
              mode="d"
              saving={saving}
              error={error}
              onSave={save}
            />
          </section>
          {manual && a.role === 'manager' && (
            <section className="card rkd-card anim-in" style={delay(110)} aria-labelledby="rkd-h-del">
              <CardHead id="rkd-h-del" title="Rekening verwijderen" />
              <p className="rkd-help">De rekening en haar saldogeschiedenis worden gewist.{a.iban && ' Overschrijvingen ernaar tellen daarna niet meer als overschrijving.'}</p>
              <button type="button" className="btn btn--danger btn--block" aria-haspopup="dialog" onClick={() => setDialog('delete')}>
                <Icon name="trash" size={18} stroke={2.2} />
                Rekening verwijderen
              </button>
            </section>
          )}
        </div>
      </div>
      {dialog === 'unlink' && conn && <RemoveLink conn={conn} accounts={accounts.data} onClose={() => setDialog(null)} onDone={removed} />}
      {dialog === 'delete' && (
        <DeleteManual a={a} updates={balances.data?.length ?? 0} onClose={() => setDialog(null)} onDone={() => navigate('/rekeningen', { replace: true })} />
      )}
    </div>
  );
}
