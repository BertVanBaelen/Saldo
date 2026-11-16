// Bijdragen (phase 0.6-5): what each member of a shared account sent into it this month, and how a member
// declares which of their own accounts do the sending. "Ontvangen" means something arrived from the member's
// declared senders, not that their part is paid: there is no target before the forecast of 0.8-4.
// The shares have no effect yet; they feed the required monthly contribution later.
// Design: finance-mockup/js/screens/start.js (contributionRow) and rekening.js (ledenCard); spec: analysis/screens/start.md.
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, SkelList } from '../components/ui';
import { canManage } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { eur0, MONTHS } from '../lib/format';
import type { Account, ContributionMember, ContributionSender, Contributions } from '../lib/types';
import { useAsync, type AsyncState } from '../lib/useAsync';
import './Bijdragen.css';

/** "2026-11" as "november". */
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? '';

/** An equal split that adds up to 100 for any number of members: the first members take the rest (34, 33, 33). */
export function equalShares(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

function Chip({ m, to }: { m: ContributionMember; to?: string }) {
  const who = m.me ? 'Jij' : m.name;
  if (m.senders === 0) {
    const text = who + ' · nog niet ingesteld';
    // Only your own chip leads somewhere: that is where the claim is made.
    return m.me && to ? (
      <li>
        <Link className="contrib-chip contrib-chip--link" to={to}>
          {text}
        </Link>
      </li>
    ) : (
      <li className="contrib-chip contrib-chip--wait">{text}</li>
    );
  }
  if (!m.confirmed) return <li className="contrib-chip contrib-chip--wait">{who + ' · nog niets ontvangen deze maand'}</li>;
  return (
    <li className="contrib-chip">
      {who + ' ' + eur0(m.received) + ' ontvangen'}
      <span aria-hidden="true"> ✓</span>
    </li>
  );
}

/** "Bijdragen november" with a chip per member. Nothing for a personal account. `to`: where "nog niet ingesteld" leads for you. */
export function ContributionRow({ c, to, className }: { c: Contributions; to?: string; className: string }) {
  const id = useId();
  if (!c.members.length) return null;
  return (
    <div className={className}>
      <span className="contrib-title" id={id}>
        Bijdragen {monthName(c.month)}
      </span>
      <ul className="contrib-chips" aria-labelledby={id}>
        {c.members.map((m) => (
          <Chip key={m.userId} m={m} to={to} />
        ))}
      </ul>
    </div>
  );
}

// ---------- Rekening: the card ----------

function RemoveSender({ a, sender, onClose, onDone }: { a: Account; sender: ContributionSender; onClose: () => void; onDone: () => void }) {
  const { online, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setError(null);
    api.removeContributionSender(a.id, sender.id).then(
      () => {
        toast('Afzender verwijderd');
        onDone();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };
  return (
    <Sheet onClose={() => !busy && onClose()} labelledBy="rkd-dlg-title" className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
      <div className="rkd-dlg-head">
        <span className="rkd-dlg-icon">
          <Icon name="trash" size={20} stroke={2.2} />
        </span>
        <h2 className="rkd-dlg-title" id="rkd-dlg-title">
          Afzender verwijderen?
        </h2>
        <button type="button" className="rk-close" aria-label="Sluiten" onClick={onClose}>
          <Icon name="close" size={18} stroke={2.4} />
        </button>
      </div>
      <p className="rkd-dlg-text">
        Betalingen van <span className="mono">{sender.iban}</span> tellen daarna niet meer als jouw bijdrage. De rekening zelf blijft zoals ze is.
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
        <button type="button" className="rk-btn rkd-btn--neg" disabled={!online || busy} onClick={go}>
          {busy ? 'Verwijderen…' : 'Verwijderen'}
        </button>
      </div>
    </Sheet>
  );
}

function Body({ a, accounts, c, onChanged }: { a: Account; accounts: Account[]; c: AsyncState<Contributions>; onChanged: () => void }) {
  const { online, toast } = useApp();
  const uid = useId();
  const data = c.data!;
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContributionSender | null>(null);
  /** The percentages being typed (by user id); `null` shows what is stored. */
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const ro = a.permission === 'read';
  const mgr = canManage(a);
  const mine = data.mySenders;
  // The masked IBAN only hides what is declared already; the server decides on a duplicate.
  const free = accounts.filter((x) => x.kind === 'personal' && x.iban && x.id !== a.id && !mine.some((s) => s.iban === x.iban));

  const members = data.members;
  const custom = members.some((m) => m.share !== null);
  const stored = custom ? members.map((m) => m.share ?? 0) : equalShares(members.length);
  const shown = members.map((m, i) => draft?.[m.userId] ?? String(stored[i]));
  const nums = shown.map((v) => (/^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN));
  const total = nums.reduce((s, n) => s + (Number.isNaN(n) ? 0 : n), 0);
  const valid = nums.every((n) => n >= 0 && n <= 100) && total === 100;
  const edit = (m: ContributionMember, value: string) => setDraft({ ...Object.fromEntries(members.map((x, i) => [x.userId, shown[i]])), [m.userId]: value });

  /** One request at a time; a failure shows the server's message in the card. */
  const run = (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    work()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  const add = () =>
    run(async () => {
      await api.addContributionSender(a.id, { fromAccountId: Number(pick) });
      setPick('');
      toast('Opgeslagen: deze afzender telt voortaan als jouw bijdrage');
      c.reload();
      onChanged();
    });
  const save = () =>
    run(async () => {
      c.setData(await api.setContributionShares(a.id, Object.fromEntries(members.map((m, i) => [m.userId, nums[i]]))));
      setDraft(null);
      toast('Verdeling opgeslagen');
    });
  const reset = () =>
    run(async () => {
      if (custom) {
        c.setData(await api.setContributionShares(a.id, null));
        toast('Verdeling weer gelijk');
      }
      setDraft(null);
    });

  const selId = uid + '-from';
  return (
    <>
      <ContributionRow c={data} className="contrib-row" />
      {ro && <p className="rkd-help">Je hebt alleen leesrechten op deze rekening. Je kan geen bijdrage instellen, maar je ziet wat er binnenkwam.</p>}
      <div className="rkd-sub">
        <h3 className="rkd-sub-title">Mijn bijdrage</h3>
        {mine.length > 0 ? (
          <ul className="contrib-senders">
            {mine.map((s) => (
              <li key={s.id}>
                <span className="mono contrib-iban">{s.iban}</span>
                {!ro && (
                  <button type="button" className="contrib-remove" disabled={!online || busy} onClick={() => setRemoving(s)} aria-haspopup="dialog">
                    Verwijderen <span className="visually-hidden">{s.iban}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rkd-help">Je hebt nog geen rekening ingesteld.</p>
        )}
        {!ro && (
          <>
            <p className="rkd-help">Kies hieronder de rekening waarmee je bijdraagt. Saldo gebruikt de rekeningen van anderen nooit.</p>
            {free.length > 0 ? (
              <>
                <div className="rk-field rk-field--tight">
                  <label className="rk-label" htmlFor={selId}>
                    Mijn bijdrage komt van …
                  </label>
                  <Select
                    id={selId}
                    value={pick}
                    onChange={setPick}
                    disabled={!online || busy}
                    options={[{ value: '', label: 'Kies een rekening' }, ...free.map((x) => ({ value: String(x.id), label: x.name + ' · ' + x.iban }))]}
                  />
                </div>
                <button type="button" className="btn btn--primary" disabled={!pick || !online || busy} aria-busy={busy || undefined} onClick={add}>
                  Dit is mijn bijdrage
                </button>
              </>
            ) : (
              <p className="rkd-help">Je hebt geen andere rekening met een IBAN om uit te kiezen. Komt je bijdrage van een rekening buiten Saldo, open dan de binnengekomen betaling bij Transacties en kies daar &ldquo;Dit is mijn bijdrage&rdquo;.</p>
            )}
          </>
        )}
      </div>
      <div className="rkd-sub">
        <h3 className="rkd-sub-title">Verdeling</h3>
        <ul className="contrib-shares">
          {members.map((m, i) => (
            <li className="contrib-share" key={m.userId}>
              {mgr ? (
                <>
                  <label htmlFor={uid + '-' + m.userId}>{m.me ? 'Jouw aandeel' : 'Aandeel van ' + m.name}</label>
                  <span className="contrib-pct">
                    <input
                      className="input mono"
                      id={uid + '-' + m.userId}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={3}
                      value={shown[i]}
                      disabled={!online || busy}
                      aria-invalid={Number.isNaN(nums[i]) || nums[i] > 100 ? true : undefined}
                      onChange={(e) => edit(m, e.target.value)}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </>
              ) : (
                <>
                  <span>{m.me ? 'Jij' : m.name}</span>
                  <span className="mono">{stored[i]} %</span>
                </>
              )}
            </li>
          ))}
        </ul>
        {mgr && (
          <div className={'contrib-total' + (valid ? '' : ' contrib-total--bad')} role="status">
            <Icon name={valid ? 'check' : 'warning'} size={14} stroke={2.4} />
            <span>{valid ? 'Samen 100 %' : nums.some((n) => Number.isNaN(n) || n > 100) ? 'Vul per lid een getal van 0 tot 100 in.' : 'Samen ' + total + ' % · moet 100 % zijn'}</span>
          </div>
        )}
        <p className="rkd-help">De verdeling heeft nog geen effect: ze wordt gebruikt zodra de nodige bijdrage per maand wordt berekend.</p>
        {mgr ? (
          <div className="rkd-actions contrib-actions">
            <button type="button" className="btn btn--primary" disabled={!draft || !valid || !online || busy} onClick={save}>
              Opslaan
            </button>
            <button type="button" className="btn btn--ghost" disabled={(!custom && !draft) || !online || busy} onClick={reset}>
              Terug naar gelijk
            </button>
          </div>
        ) : (
          <p className="rkd-help">Alleen de beheerder past de verdeling aan. Standaard delen alle leden gelijk.</p>
        )}
      </div>
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      {!online && (
        <p className="rk-offline">
          <Icon name="cloudOff" size={14} stroke={2.2} />
          Je bent offline. Opslaan kan weer zodra je verbinding hebt.
        </p>
      )}
      {removing && (
        <RemoveSender
          a={a}
          sender={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            c.reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** Card "Bijdragen" on the page of a shared account: the month's chips, your own senders, the split. `onChanged`: a sender was added or removed, so row labels elsewhere on the page are stale. */
export function ContributionsCard({ a, accounts, onChanged }: { a: Account; accounts: Account[]; onChanged: () => void }) {
  const { dataVersion } = useApp();
  const c = useAsync((signal) => api.contributions(a.id, undefined, signal), [a.id, dataVersion]);
  return (
    <section className="card rkd-card anim-in" style={delay(110)} id="bijdragen" aria-labelledby="rkd-h-bijdr">
      <div className="rkd-card-head">
        <span className="rkd-card-titles">
          <h2 className="rkd-card-title" id="rkd-h-bijdr">
            Bijdragen
          </h2>
          {c.data?.members.length ? <span className="rkd-card-meta">Wat er in {monthName(c.data.month)} binnenkwam</span> : null}
        </span>
      </div>
      {c.data ? <Body a={a} accounts={accounts} c={c} onChanged={onChanged} /> : c.error ? <ErrorState message={c.error} onRetry={c.reload} /> : <SkelList rows={2} label="Bijdragen laden" />}
    </section>
  );
}
