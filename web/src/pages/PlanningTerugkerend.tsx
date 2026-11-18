// Planning · Terugkerend (plan 0.8-7): the detected items to confirm, the confirmed items, the ignored ones and the item form that
// adds, confirms, edits and deletes them. Design: finance-mockup/js/screens/planning.js terugkerend(); spec: analysis/screens/planning.md.
// The exported tab stays hook-free (see planningTabs.ts): everything below `Body` mounts for the selected tab only.
import { useId, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { ErrorState, SkelList, useIsDesktop } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { eur } from '../lib/format';
import { itemRhythm, missedNote, suggestionRhythm, type RecurringItem, type RecurringSuggestion } from '../lib/planningItems';
import type { Account } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { TabPanel } from '../ui';
import { ItemForm, type ItemFormMode } from './PlanningItemForm';
import { AccountPill } from './PlanningParts';
import type { PlanningTabProps } from './planningTabs';

export function PlanningTerugkerend(props: PlanningTabProps) {
  return (
    <TabPanel id="terugkerend" className="pl-panel">
      <Body {...props} />
    </TabPanel>
  );
}

const amountClass = (cents: number) => 'mono pl-rec-amount' + (cents < 0 ? ' pl-rec-amount--neg' : '');
/** A suggestion has no id: its account, name, rhythm and amount tell it from the next. */
const suggestionKey = (s: RecurringSuggestion) => [s.accountId, s.counterparty, s.frequency, s.day, s.amount].join('|');

/** The first two lines of a row, shared by the confirmed and the ignored list: name, then account and rhythm (columns from 1280 px). */
function RowText({ item, account }: { item: RecurringItem; account: Account }) {
  return (
    <span className="pl-rec-main">
      <span className="pl-rec-name">{item.description}</span>
      <span className="pl-rec-sub">
        <AccountPill account={account} />
        <span className="pl-rec-rhythm">{itemRhythm(item)}</span>
      </span>
    </span>
  );
}

function Body({ planning, accounts, scope, reload, canEdit }: PlanningTabProps) {
  const { today, dataVersion, toast } = useApp();
  const desk = useIsDesktop();
  const uid = useId();
  const items = useAsync((signal) => api.planningItems(scope, signal), [scope, dataVersion]);
  const found = useAsync((signal) => api.planningSuggestions(scope, signal), [scope, dataVersion]);
  const [form, setForm] = useState<ItemFormMode | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  /** The suggestion or ignored item a request is running for: one at a time. */
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.error || found.error) {
    return (
      <ErrorState
        message={(items.error ?? found.error)!}
        onRetry={() => {
          items.reload();
          found.reload();
        }}
      />
    );
  }
  if (!items.data || !found.data) {
    return (
      <div className="pl-list">
        <SkelList rows={4} label="Terugkerende posten laden" />
      </div>
    );
  }

  // An answer for another scope can still be on screen while the next one loads: only items of the accounts in view show.
  const accountOf = (id: number) => accounts.find((a) => a.id === id);
  const mayEdit = (id: number) => accountOf(id)?.permission === 'edit';
  const shown = items.data.items.flatMap((item) => {
    const account = accountOf(item.accountId);
    return account ? [{ item, account }] : [];
  });
  const confirmed = shown.filter((r) => r.item.state === 'confirmed');
  const ignored = shown.filter((r) => r.item.state === 'ignored');
  const open = found.data.suggestions.flatMap((s) => {
    const account = accountOf(s.accountId);
    return account ? [{ s, account }] : [];
  });
  const missed = new Map((planning?.accounts ?? []).flatMap((p) => p.missed ?? []).map((m) => [m.itemId, m.date]));

  /** A stored, changed or deleted item moves the lists, the forecast and the alerts of Start. */
  const changed = () => {
    items.reload();
    found.reload();
    reload();
  };
  const run = (key: string, work: () => Promise<void>) => {
    if (working) return;
    setWorking(key);
    setError(null);
    work()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setWorking(null));
  };
  // Negeren stores an ignored item: an ignored item's name is its counterparty, and it is judged like any item (the month of a quarterly or yearly one included).
  const ignore = (s: RecurringSuggestion) =>
    run(suggestionKey(s), async () => {
      const created = await api.createPlanningItem({
        accountId: s.accountId,
        description: s.counterparty,
        counterparty: s.counterparty,
        amount: s.amount,
        amountRule: s.amountRule,
        frequency: s.frequency,
        day: s.day,
        ...(s.month === null ? {} : { month: s.month }),
        kind: s.kind,
        state: 'ignored',
      });
      toast('Genegeerd', { label: 'Ongedaan maken', run: () => void api.deletePlanningItem(created.id).then(changed) });
      changed();
    });
  // Deleting an ignored item brings its suggestion back.
  const show = (item: RecurringItem) =>
    run('i' + item.id, async () => {
      await api.deletePlanningItem(item.id);
      toast('Weer te bevestigen');
      changed();
    });

  const row = ({ item, account }: { item: RecurringItem; account: Account }) => {
    const text = <RowText item={item} account={account} />;
    const amount = <span className={amountClass(item.amount)}>{eur(item.amount, true)}</span>;
    const date = missed.get(item.id);
    return (
      <li key={item.id}>
        {mayEdit(item.accountId) ? (
          <button type="button" className="pl-rec" aria-haspopup="dialog" onClick={() => setForm({ type: 'edit', item })}>
            {text}
            {amount}
          </button>
        ) : (
          <div className="pl-rec">
            {text}
            {amount}
          </div>
        )}
        {date && <p className="pl-rec-note">{missedNote(date)}</p>}
      </li>
    );
  };

  const ignoredId = uid + '-ignored';
  return (
    <div className="pl-terug">
      {(open.length > 0 || desk) && (
        <section className="pl-section" aria-labelledby={uid + '-open'}>
          <h2 className="pl-h2" id={uid + '-open'}>
            Te bevestigen <span className="pl-h2-count">· {open.length}</span>
          </h2>
          {open.length > 0 ? (
            <ul className="pl-suggs">
              {open.map(({ s, account }) => (
                <li className="pl-sugg" key={suggestionKey(s)}>
                  <div className="pl-sugg-top">
                    <span className="pl-sugg-text">
                      <span className="pl-sugg-name">{s.description}</span>
                      <span className="pl-sugg-sub">
                        <AccountPill account={account} />
                        {suggestionRhythm(s)}
                      </span>
                    </span>
                    <span className="mono pl-sugg-amount">{eur(s.amount, true)}</span>
                  </div>
                  {mayEdit(s.accountId) && (
                    <div className="pl-sugg-actions">
                      <button type="button" className="btn btn--primary pl-btn-sm" aria-label={'Bevestigen: ' + s.description} disabled={!!working} onClick={() => setForm({ type: 'confirm', suggestion: s })}>
                        Bevestigen
                      </button>
                      <button type="button" className="btn btn--ghost pl-btn-sm" aria-label={'Negeren: ' + s.description} disabled={!!working} aria-busy={working === suggestionKey(s) || undefined} onClick={() => ignore(s)}>
                        Negeren
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="pl-empty-card">Alles bevestigd.</p>
          )}
        </section>
      )}
      <div className="pl-terug-main">
        <section className="pl-section" aria-labelledby={uid + '-confirmed'}>
          <h2 className="pl-h2" id={uid + '-confirmed'}>
            Bevestigd
          </h2>
          <div className="pl-list">{confirmed.length > 0 ? <ul className="pl-recs pl-recs--cols">{confirmed.map(row)}</ul> : <p className="pl-empty">Nog geen terugkerende posten.</p>}</div>
        </section>
        {ignored.length > 0 && (
          <section className="pl-section">
            <h2 className="pl-h2">
              <button type="button" className="pl-fold" aria-expanded={showIgnored} aria-controls={ignoredId} onClick={() => setShowIgnored((v) => !v)}>
                Genegeerd <span className="pl-h2-count">· {ignored.length}</span>
                <Icon name="chevron" size={16} stroke={2.4} />
              </button>
            </h2>
            {showIgnored && (
              <div className="pl-list" id={ignoredId}>
                <ul className="pl-recs">
                  {ignored.map(({ item, account }) => (
                    <li key={item.id}>
                      <div className="pl-rec">
                        <RowText item={item} account={account} />
                        {mayEdit(item.accountId) && (
                          <button type="button" className="btn btn--ghost pl-btn-sm" aria-label={'Toch tonen: ' + item.description} disabled={!!working} aria-busy={working === 'i' + item.id || undefined} onClick={() => show(item)}>
                            Toch tonen
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
        {error && (
          <p className="pl-err" role="alert">
            {error}
          </p>
        )}
        {canEdit && (
          <button type="button" className="btn btn--dashed btn--block" aria-haspopup="dialog" onClick={() => setForm({ type: 'new' })}>
            <Icon name="plus" size={16} stroke={2.6} />
            Terugkerende post toevoegen
          </button>
        )}
      </div>
      {form && (
        <ItemForm
          mode={form}
          accounts={accounts}
          today={planning?.today ?? today}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            changed();
          }}
        />
      )}
    </div>
  );
}
