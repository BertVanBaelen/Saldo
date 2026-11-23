// Bijdragen (phase 0.6-5): what each member of a shared account sent into it this month, and how a member
// declares which of their own accounts do the sending. "Ontvangen" means something arrived from the member's
// declared senders; only with the target of the forecast (0.8-4, `required`) does the ✓ mean the part is covered.
// The shares set each member's part of the required monthly contribution, which the planning calculates (0.8-4, 0.8-6).
// Contributors without Saldo (0.8.1-7) count like members: a chip after the members, a row in "Bijdragers zonder Saldo", a line in the
// share editor ("Aandeel van Mama"); their sheet is in BijdragenBijdrager.tsx. A stored IBAN is only ever shown masked, in that sheet.
// Design: finance-mockup/js/screens/start.js (contributionRow) and rekening.js (ledenCard); spec: analysis/screens/start.md.
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, SheetX, SkelList } from '../components/ui';
import { canManage } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { eur0, MONTHS } from '../lib/format';
import type { Account, ContributionMember, ContributionSender, Contributions, LinkOffer } from '../lib/types';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { ContributorSheet } from './BijdragenBijdrager';
import './Bijdragen.css';

/** "2026-11" as "november". */
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? '';

/** An equal split that adds up to 100 for any number of members: the first members take the rest (34, 33, 33). */
export function equalShares(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

/** What arrived against what is needed: a member and a contributor without Saldo read the same way. */
interface Standing {
  received: number;
  confirmed: boolean;
  required?: number | null;
  covered?: boolean | null;
}

/** With a forecast (0.8-4) the ✓ means the part is covered; without one it only means something arrived. `text` is without the name. */
function standing(v: Standing): { tone: 'ok' | 'warn' | 'wait'; text: string } {
  if (v.required != null && !v.covered) return { tone: 'warn', text: eur0(v.received) + ' · nodig ' + eur0(v.required) };
  if (v.required == null && !v.confirmed) return { tone: 'wait', text: 'nog niets ontvangen deze maand' };
  return { tone: 'ok', text: eur0(v.received) + ' ontvangen' };
}

/** The chip of a member whose senders are set and of a contributor without Saldo (their IBAN is stored with them). */
function StandingChip({ name, v }: { name: string; v: Standing }) {
  const s = standing(v);
  if (s.tone === 'warn') return <li className="contrib-chip contrib-chip--warn">{name + ' ' + s.text}</li>;
  if (s.tone === 'wait') return <li className="contrib-chip contrib-chip--wait">{name + ' · ' + s.text}</li>;
  return (
    <li className="contrib-chip">
      {name + ' ' + s.text}
      <span aria-hidden="true"> ✓</span>
    </li>
  );
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
  return <StandingChip name={who} v={m} />;
}

/** "Bijdragen november" with a chip per member, then one per contributor without Saldo. Nothing for a personal account. `to`: where "nog niet ingesteld" leads for you. */
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
        {(c.contributors ?? []).map((x) => (
          <StandingChip key={'c' + x.id} name={x.name} v={x} />
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
        <SheetX className="rk-close" onClose={onClose} instant={busy} />
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
  /** The percentages being typed (by key: a user id, or `c<id>` for a contributor); `null` shows what is stored. */
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  /** The contributor sheet: a new one, or the one with this id. */
  const [sheet, setSheet] = useState<'new' | number | null>(null);
  const ro = a.permission === 'read';
  const mgr = canManage(a);
  const mine = data.mySenders;
  // The masked IBAN only hides what is declared already; the server decides on a duplicate.
  const free = accounts.filter((x) => x.kind === 'personal' && x.iban && x.id !== a.id && !mine.some((s) => s.iban === x.iban));

  const members = data.members;
  const contributors = data.contributors ?? [];
  const offers = data.linkOffers ?? [];
  // The split covers members and contributors together; the keys are the ones the server takes ("<userId>", "c<id>").
  const parties = [
    ...members.map((m) => ({ key: String(m.userId), me: m.me, name: m.name, share: m.share })),
    ...contributors.map((x) => ({ key: 'c' + x.id, me: false, name: x.name, share: x.share })),
  ];
  const custom = parties.some((p) => p.share !== null);
  const stored = custom ? parties.map((p) => p.share ?? 0) : equalShares(parties.length);
  const shown = parties.map((p, i) => draft?.[p.key] ?? String(stored[i]));
  const nums = shown.map((v) => (/^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN));
  const total = nums.reduce((s, n) => s + (Number.isNaN(n) ? 0 : n), 0);
  const valid = nums.every((n) => n >= 0 && n <= 100) && total === 100;
  const edit = (key: string, value: string) => setDraft({ ...Object.fromEntries(parties.map((x, i) => [x.key, shown[i]])), [key]: value });
  const editing = typeof sheet === 'number' ? contributors.find((x) => x.id === sheet) : undefined;

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
      c.setData(await api.setContributionShares(a.id, Object.fromEntries(parties.map((p, i) => [p.key, nums[i]]))));
      setDraft(null);
      toast('Verdeling opgeslagen');
    });
  /** After a write the server answers the month's contributions; adding or removing a contributor resets the split to equal. */
  const applied = (next: Contributions, text: string) => {
    c.setData(next);
    setDraft(null);
    setSheet(null);
    toast(text);
    onChanged();
  };
  const answer = (o: LinkOffer, yes: boolean) =>
    run(async () => {
      c.setData(await api.answerContributorLink(a.id, o.contributorId, yes));
      setDraft(null);
      toast(yes ? 'Opgeslagen: deze rekening telt voortaan als jouw bijdrage' : 'Oké, er verandert niets');
      if (yes) onChanged();
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
      {data.need != null && (
        <div className="contrib-need">
          <p className="contrib-need-total">
            Nodig in {monthName(data.month)}: <span className="mono">{eur0(data.need)}</span>
          </p>
          <ul className="contrib-need-list">
            {members.map((m) =>
              m.required == null ? null : (
                <li key={m.userId}>
                  {m.me ? 'Jij' : m.name} · nodig <span className="mono">{eur0(m.required)}</span>
                </li>
              ),
            )}
            {contributors.map((x) =>
              x.required == null ? null : (
                <li key={'c' + x.id}>
                  {x.name} · nodig <span className="mono">{eur0(x.required)}</span>
                </li>
              ),
            )}
          </ul>
          <p className="rkd-help">
            Op basis van de planning: vaste kosten, budgetten en de buffer van deze rekening.{' '}
            <Link className="contrib-need-link" to={'/planning?maand=' + data.month + '#budget'}>
              Bekijk de berekening
            </Link>
          </p>
        </div>
      )}
      {offers.map((o) => (
        <div className="contrib-offer" role="group" aria-labelledby={uid + '-offer-' + o.contributorId} key={o.contributorId}>
          <p className="contrib-offer-text" id={uid + '-offer-' + o.contributorId}>
            <strong>{o.name}</strong> stond als bijdrager met rekening <span className="mono">{o.iban}</span>. Is dat jouw rekening?
          </p>
          {!ro && (
            <>
              <p className="rkd-help">Antwoord je ja, dan telt die rekening voortaan als jouw bijdrage en verdwijnt {o.name} als bijdrager. De verdeling wordt weer gelijk.</p>
              <div className="rkd-actions contrib-actions">
                <button type="button" className="btn btn--primary" disabled={!online || busy} onClick={() => answer(o, true)}>
                  Ja, dat ben ik
                </button>
                <button type="button" className="btn btn--ghost" disabled={!online || busy} onClick={() => answer(o, false)}>
                  Nee
                </button>
              </div>
            </>
          )}
        </div>
      ))}
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
              <p className="rkd-help">Je hebt geen andere rekening met een IBAN om uit te kiezen. Komt je bijdrage van een rekening buiten Saldo, open dan de binnengekomen betaling bij Transacties en kies daar bij &ldquo;Dit is de bijdrage van&rdquo; voor &ldquo;mij&rdquo;.</p>
            )}
          </>
        )}
      </div>
      <div className="rkd-sub">
        <h3 className="rkd-sub-title">Bijdragers zonder Saldo</h3>
        {contributors.length > 0 ? (
          <ul className="contrib-others">
            {contributors.map((x, i) => {
              const s = standing(x);
              const offered = x.linkUserId !== undefined ? members.find((m) => m.userId === x.linkUserId) : undefined;
              const body = (
                <>
                  <span className="contrib-other-main">
                    <span className="contrib-other-name">{x.name}</span>{' '}
                    <span className={'contrib-chip' + (s.tone === 'ok' ? '' : ' contrib-chip--' + s.tone)}>
                      {s.text}
                      {s.tone === 'ok' && <span aria-hidden="true"> ✓</span>}
                    </span>{' '}
                    {offered && <span className="contrib-other-note">Koppeling voorgesteld aan {offered.me ? 'jou' : offered.name}</span>}
                  </span>{' '}
                  <span className="mono contrib-other-share">{stored[members.length + i]} %</span>
                </>
              );
              return (
                <li key={x.id}>
                  {ro ? (
                    <div className="contrib-other">{body}</div>
                  ) : (
                    <button type="button" className="contrib-other contrib-other--btn" aria-haspopup="dialog" disabled={busy} onClick={() => setSheet(x.id)}>
                      <span className="visually-hidden">Bijdrager aanpassen:</span>{' '}
                      {body}
                      <Icon name="chevron" size={16} stroke={2.4} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rkd-help">Betaalt er iemand mee die Saldo niet gebruikt? Voeg die persoon toe met naam en IBAN. Saldo herkent de betaling aan de IBAN en rekent een deel van wat nodig is voor die persoon mee.</p>
        )}
        {!ro && (
          <button type="button" className="btn btn--dashed btn--block" aria-haspopup="dialog" disabled={!online || busy} onClick={() => setSheet('new')}>
            Bijdrager toevoegen
          </button>
        )}
      </div>
      <div className="rkd-sub">
        <h3 className="rkd-sub-title">Verdeling</h3>
        <ul className="contrib-shares">
          {parties.map((p, i) => (
            <li className="contrib-share" key={p.key}>
              {mgr ? (
                <>
                  <label htmlFor={uid + '-' + p.key}>{p.me ? 'Jouw aandeel' : 'Aandeel van ' + p.name}</label>
                  <span className="contrib-pct">
                    <input
                      className="input mono"
                      id={uid + '-' + p.key}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={3}
                      value={shown[i]}
                      disabled={!online || busy}
                      aria-invalid={Number.isNaN(nums[i]) || nums[i] > 100 ? true : undefined}
                      onChange={(e) => edit(p.key, e.target.value)}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </>
              ) : (
                <>
                  <span>{p.me ? 'Jij' : p.name}</span>
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
        <p className="rkd-help">Het aandeel bepaalt ieders deel van wat nodig is.</p>
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
      {sheet === 'new' && <ContributorSheet a={a} onClose={() => setSheet(null)} onDone={applied} />}
      {editing && <ContributorSheet key={editing.id} a={a} contributor={editing} members={members} onClose={() => setSheet(null)} onDone={applied} onUpdate={c.setData} />}
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
