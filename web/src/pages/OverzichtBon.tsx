// Overzichtsbon: a week, month, quarter, year or custom range as a receipt that prints (plan 0.9-3d, analysis/screens/overzichtbon.md). Loaded lazily (App.tsx).
// Route `/overzicht/bon/:periode/:van` (`week`, `maand`, `kwartaal`, `jaar` or `eigen`, `van` a date; the page rewrites it to the Monday or the 1st of
// the period; `eigen` also needs `?tot=`, which becomes the last day of its month). The URL holds the period, so a reload and Back work; the
// period and the scope switch REPLACE the history entry. `?scope=` (the notifications send `alles`) wins for this page only: the app-wide scope
// is never changed here, which is why the scope switch is local and not the shell's ScopeSwitch. `?rekening=<id>` is the one account the receipt
// is for (Overzicht's account filter): it goes to the API as `account` and stays in every link of the page, except when the scope changes.
// Data: GET /api/reports/receipt (the Go model, lib/types.ts `Receipt`); the paper is ReceiptBody.tsx inside the vendored ReceiptPrinter.
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { delay, ErrorState, Skel, useTitle } from '../components/ui';
import { api, errorMessage, isAbort } from '../lib/api';
import {
  BON_PERIODS,
  canGoNext,
  isBonKind,
  isBonPeriod,
  isDate,
  isScope,
  overzichtRangeHref,
  paperLabel,
  parseAccount,
  periodEnd,
  periodStart,
  rangeLabel,
  shiftPeriod,
  stepLabel,
  switchPeriod,
  type BonKind,
  type BonPeriod,
} from '../lib/receipt';
import type { Receipt, ReceiptQuery, Scope } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { ReceiptPrinter, SegmentedControl } from '../ui';
import { NotBuilt } from './NotBuilt';
import { ReceiptBody } from './ReceiptBody';
import './OverzichtBon.css';

const SCOPES: { id: Scope; label: string; icon: IconName }[] = [
  { id: 'alles', label: 'Alles', icon: 'grid' },
  { id: 'persoonlijk', label: 'Persoonlijk', icon: 'person' },
  { id: 'gedeeld', label: 'Gedeeld', icon: 'people' },
];

/** The answer with the request it was for: an answer for another period or scope is stale (useAsync keeps the last one while it reloads). */
type Loaded = { key: string; model: Receipt; error?: undefined } | { key: string; error: string; model?: undefined };

/** The scope switch of Overzicht (same markup and look), but local to this page: it writes `?scope=` and never the app-wide scope. */
function ScopePick({ value, onPick }: { value: Scope; onPick: (s: Scope) => void }) {
  return (
    <div className="scope anim-in" role="group" aria-label="Welke rekeningen">
      {SCOPES.map((s) => (
        <button key={s.id} type="button" className="scope-btn" data-scope={s.id} aria-pressed={value === s.id} onClick={() => onPick(s.id)}>
          <Icon name={s.icon} size={16} stroke={2.2} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** The paper while the receipt loads: a card with grey lines. */
function GhostPaper() {
  return (
    <div className="bon-ghost anim-in" role="status" aria-label="Bon laden">
      <Skel w="40%" h={14} />
      <Skel w="70%" h={12} />
      {Array.from({ length: 9 }, (_, i) => (
        <Skel key={i} w={['100%', '88%', '94%'][i % 3]} h={12} />
      ))}
    </div>
  );
}

export function OverzichtBon() {
  const { periode, van } = useParams();
  const { search } = useLocation();
  // An unknown period or a date that is none (`2026-02-30`) is an unknown page, and so is a custom range without a real `tot`; a date inside
  // the period goes to the period's first day, and a `tot` to the last day of its month (the server normalises the range the same way).
  if (!isBonPeriod(periode) || !isDate(van)) return <NotBuilt id={null} />;
  const asked = new URLSearchParams(search).get('tot');
  if (periode === 'eigen' && !isDate(asked)) return <NotBuilt id={null} />;
  const start = periodStart(periode, van);
  const tot = periode === 'eigen' ? periodEnd('eigen', start, asked!) : undefined;
  if (start !== van || (tot !== undefined && tot !== asked)) {
    const next = new URLSearchParams(search);
    if (tot !== undefined) next.set('tot', tot);
    return <Navigate to={{ pathname: '/overzicht/bon/' + periode + '/' + start, search: tot !== undefined && tot !== asked ? '?' + next.toString() : search }} replace />;
  }
  return <BonPage kind={periode} start={start} tot={tot} />;
}

/** `tot`: the last day of a custom range (`eigen`), else `undefined`. */
function BonPage({ kind, start, tot }: { kind: BonPeriod; start: string; tot: string | undefined }) {
  useTitle('Overzichtsbon');
  const { scope: appScope, today, dataVersion } = useApp();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const asked = params.get('scope');
  const scope: Scope = isScope(asked) ? asked : appScope;
  // The one account of Overzicht's filter; a value that is no positive whole number is no account.
  const account = parseAccount(params.get('rekening'));

  const key = [kind, start, tot ?? '', scope, account ?? ''].join('|');
  const bon = useAsync<Loaded>(
    async (signal) => {
      try {
        const q: ReceiptQuery = { periode: kind, van: start, scope };
        if (tot !== undefined) q.tot = tot;
        if (account !== undefined) q.account = account;
        return { key, model: await api.receipt(q, signal) };
      } catch (e) {
        if (isAbort(e)) throw e;
        return { key, error: errorMessage(e) };
      }
    },
    [key, dataVersion],
  );
  const answer = bon.data?.key === key ? bon.data : undefined;
  const model = answer?.model;

  // The period is in the URL; changing it replaces the entry. The query (`?scope=`, `?rekening=`) stays as it came, but for `tot`: only a
  // custom range has one, and every way out of it (a segment) leads to a kind that does not.
  const go = (to: BonKind, van: string) => {
    const n = new URLSearchParams(search);
    n.delete('tot');
    const rest = n.toString();
    navigate({ pathname: '/overzicht/bon/' + to + '/' + van, search: rest ? '?' + rest : '' }, { replace: true });
  };
  // A new scope drops the account: it was picked in the old scope and may not belong to the new one (the API would answer 400).
  const pickScope = (s: Scope) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('scope', s);
        if (s !== scope) n.delete('rekening');
        return n;
      },
      { replace: true },
    );

  // Back: not before the history's first period. The model has no `firstDate`: a period that holds the start of the history (`partialFrom`)
  // or has nothing in it (before the history) is the last one back. Forward: not past the running period. Both come from the URL's
  // anchor, so the arrows work in the error state too (a period in the future answers 400 and Back must lead out of it).
  const backDisabled = !!model && (model.empty || model.partialFrom !== null);
  // A custom range has no arrows: it is a range of Overzicht's, not a place in a row of periods.
  const step: BonKind | null = isBonKind(kind) ? kind : null;
  const nextDisabled = !step || !canGoNext(step, start, today);
  const label = model ? model.label : rangeLabel(kind, start, tot);

  let body;
  if (model) {
    body = (
      <>
        <ReceiptPrinter key={key} label={paperLabel(model.label)} autoPrint>
          <ReceiptBody model={model} />
        </ReceiptPrinter>
        <div className="bon-after anim-in" style={delay(60)}>
          {/* Overzicht has no week, and Transacties no day range (its `periode` is a month, a quarter or a year): a week links to the list. */}
          {kind === 'week' ? (
            <Link className="btn btn--ghost" to="/transacties">
              Bekijk de transacties
            </Link>
          ) : (
            <Link className="btn btn--ghost" to={overzichtRangeHref(model.from, model.to, account)}>
              Open in Overzicht
            </Link>
          )}
          {model.notes.length > 0 && (
            <ul className="bon-notes" aria-label="Opmerkingen bij deze bon">
              {model.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  } else if (answer?.error) {
    body = <ErrorState message={answer.error} onRetry={bon.reload} />;
  } else {
    body = <GhostPaper />;
  }

  return (
    <div className="page">
      <div className="bon-head anim-fade">
        <Link className="page-back" to="/overzicht" aria-label="Terug naar Overzicht">
          <Icon name="back" size={22} stroke={2.4} />
        </Link>
        <h1>Overzichtsbon</h1>
      </div>
      {kind === 'eigen' && <p className="bon-eigen anim-fade">Eigen periode</p>}
      <div className="bon-tools anim-in" style={delay(30)}>
        {/* A custom range is none of the four: no segment is selected, and a tap goes to the kind that holds the range's last day. */}
        <SegmentedControl
          className="bon-seg"
          aria-label="Periode"
          options={BON_PERIODS}
          value={kind}
          onChange={(k) => isBonKind(k) && k !== kind && go(k, switchPeriod(kind, k, start, today, tot))}
        />
        {step ? (
          <div className="bon-nav" role="group" aria-label="Periode kiezen">
            <button type="button" className="icon-btn" aria-label={stepLabel(step, -1)} disabled={backDisabled} onClick={() => go(step, shiftPeriod(step, start, -1))}>
              <Icon name="back" size={20} stroke={2.4} />
            </button>
            <span className="bon-nav-label" aria-live="polite">
              {label}
            </span>
            <button type="button" className="icon-btn" aria-label={stepLabel(step, 1)} disabled={nextDisabled} onClick={() => go(step, shiftPeriod(step, start, 1))}>
              <Icon name="chevron" size={20} stroke={2.4} />
            </button>
          </div>
        ) : (
          <div className="bon-nav">
            <span className="bon-nav-label" aria-live="polite">
              {label}
            </span>
          </div>
        )}
        <ScopePick value={scope} onPick={pickScope} />
      </div>
      {body}
    </div>
  );
}
