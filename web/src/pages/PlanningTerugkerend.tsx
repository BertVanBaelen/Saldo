// Planning instellen · Terugkerend (plan 0.8-7, moved from the Planning tab by 0.8.1-8): the detected items to confirm ("Gevonden · te
// bevestigen"), the confirmed items as "Inkomend" and "Uitgaand", the ignored ones, and the item sheet that adds, confirms, edits and
// deletes them. Design: the board "Planning instellen" (Terugkerend); spec: plan 0.8.1-8.
// A section of the screen, not a tab: it may use hooks. The account in view is the one in `accounts`; the page owns the items' load.
import { useId, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { ErrorState, SkelList } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { eur } from '../lib/format';
import { itemRhythm, missedNote, monthlySummary, suggestionRhythm, type RecurringItem, type RecurringSuggestion } from '../lib/planningItems';
import type { TreeCategory } from '../lib/types';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { ItemForm, type ItemFormMode } from './PlanningItemForm';
import type { PlanningSectionProps } from './planningTabs';

export interface TerugkerendProps extends PlanningSectionProps {
  /** The page's load of `GET /api/planning/items` (its count is in the section control). */
  items: AsyncState<{ items: RecurringItem[] }>;
  /** The page's load of `GET /api/categories` (0.9.1-3): names the category of a row and gives the item sheet its Categorie field; without it neither shows. */
  tree?: AsyncState<TreeCategory[]>;
}

const amountClass = (cents: number) => 'mono pl-rec-amount' + (cents < 0 ? ' pl-rec-amount--neg' : ' pl-rec-amount--pos');
/** A suggestion has no id: its account, name, rhythm and amount tell it from the next. */
const suggestionKey = (s: RecurringSuggestion) => [s.accountId, s.counterparty, s.frequency, s.day, s.amount].join('|');

/** The first two lines of a row, shared by the confirmed and the ignored list: name, then rhythm (and the category's name, when there is one). */
function RowText({ item, category }: { item: RecurringItem; category?: string }) {
  return (
    <span className="pl-rec-main">
      <span className="pl-rec-name">{item.description}</span>
      <span className="pl-rec-sub">{itemRhythm(item, category)}</span>
    </span>
  );
}

export function PlanningTerugkerend({ planning, accounts, scope, reload, canEdit, items, tree }: TerugkerendProps) {
  const { today, dataVersion, toast } = useApp();
  const uid = useId();
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

  // An answer for another scope or account can still be on screen while the next one loads: only items of the accounts in view show.
  const accountOf = (id: number) => accounts.find((a) => a.id === id);
  const mayEdit = (id: number) => accountOf(id)?.permission === 'edit';
  const shown = items.data.items.filter((item) => accountOf(item.accountId));
  const confirmed = shown.filter((item) => item.state === 'confirmed');
  const incoming = confirmed.filter((item) => item.amount > 0);
  const outgoing = confirmed.filter((item) => item.amount < 0);
  const ignored = shown.filter((item) => item.state === 'ignored');
  const open = found.data.suggestions.filter((s) => accountOf(s.accountId));
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

  const byId = new Map((tree?.data ?? []).map((c) => [c.id, c]));
  const row = (item: RecurringItem) => {
    const own = item.categoryId == null ? undefined : byId.get(item.categoryId);
    const text = <RowText item={item} category={own && categoryLabel(own, byId)} />;
    const amount = <span className={amountClass(item.amount)}>{eur(item.amount, true)}</span>;
    const date = missed.get(item.id);
    return (
      <li key={item.id}>
        {mayEdit(item.accountId) ? (
          <button type="button" className="pl-rec" aria-haspopup="dialog" onClick={() => setForm({ type: 'edit', item })}>
            {text}
            {amount}
            <span className="pl-rec-chev" aria-hidden="true">
              <Icon name="chevron" size={16} stroke={2.2} />
            </span>
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
  const list = (label: string, rows: RecurringItem[]) =>
    rows.length > 0 && (
      <section className="pl-section" aria-labelledby={uid + label}>
        <h3 className="pl-h3" id={uid + label}>
          {label}
        </h3>
        <div className="pl-list">
          <ul className="pl-recs">{rows.map(row)}</ul>
        </div>
      </section>
    );

  const ignoredId = uid + '-ignored';
  return (
    <div className="pl-terug">
      {open.length > 0 && (
        <section className="pl-section" aria-labelledby={uid + '-open'}>
          <h3 className="pl-h3" id={uid + '-open'}>
            Gevonden · te bevestigen · {open.length}
          </h3>
          <ul className="pl-suggs">
            {open.map((s) => (
              <li className="pl-sugg" key={suggestionKey(s)}>
                <div className="pl-sugg-top">
                  <span className="pl-sugg-text">
                    <span className="pl-sugg-name">{s.description}</span>
                    <span className="pl-sugg-sub">{suggestionRhythm(s)}</span>
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
        </section>
      )}
      {list('Inkomend', incoming)}
      {list('Uitgaand', outgoing)}
      {confirmed.length === 0 && <p className="pl-empty-card">Nog geen terugkerende posten.</p>}
      {confirmed.length > 0 && <p className="pl-sum-line">{monthlySummary(confirmed)}</p>}
      {ignored.length > 0 && (
        <section className="pl-section">
          <h3 className="pl-h3">
            <button type="button" className="pl-fold" aria-expanded={showIgnored} aria-controls={ignoredId} onClick={() => setShowIgnored((v) => !v)}>
              Genegeerd · {ignored.length}
              <Icon name="chevron" size={16} stroke={2.4} />
            </button>
          </h3>
          {showIgnored && (
            <div className="pl-list" id={ignoredId}>
              <ul className="pl-recs">
                {ignored.map((item) => (
                  <li key={item.id}>
                    <div className="pl-rec">
                      <RowText item={item} />
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
      {form && (
        <ItemForm
          mode={form}
          accounts={accounts}
          today={planning?.today ?? today}
          tree={tree}
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
