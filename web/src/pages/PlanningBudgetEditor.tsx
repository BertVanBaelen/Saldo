// Planning · the budget editor (plan 0.8-6; the mockup has none): a sheet to set one category's budget on one account, from the month
// shown on. Amount with − / + in € 10 steps, "Gebruik het gemiddelde" (rounded up to whole euros) and "Geen budget" (the forecast then
// uses the average of the past months). `PUT /api/planning/budgets` stores it "from this month on" (docs/api.md).
import { useId, useState } from 'react';
import { useApp } from '../app/AppContext';
import { CatIcon } from '../components/CatIcon';
import { Sheet, useSheetClose } from '../components/Sheet';
import { SheetX } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { eur, MONTHS, parseMoney } from '../lib/format';
import type { PlanBudget } from '../lib/planning';
import type { Account, TreeCategory } from '../lib/types';
import { AmountInput, Switch } from '../ui';
import './PlanningBudget.css';

/** The editor's subject: an account and the budget row being changed; without a row the sheet first asks for a category. */
export interface BudgetTarget {
  account: Account;
  entry?: PlanBudget;
}

/** The highest amount the server accepts (€ 1.000.000). */
const MAX = 100_000_000;
const STEP = 1000;

/** Cents as the field shows them: 35000 → "350", 6247 → "62,47". */
const fieldOf = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ','));
const ceilEuro = (cents: number) => Math.ceil(cents / 100) * 100;

function Cancel({ onClose }: { onClose: () => void }) {
  const close = useSheetClose();
  return (
    <button type="button" className="btn btn--ghost" onClick={close ?? onClose}>
      Annuleren
    </button>
  );
}

function Form({ account, month, categoryId, entry, onClose, onSaved }: { account: Account; month: string; categoryId: number; entry?: PlanBudget; onClose: () => void; onSaved: () => void }) {
  const { online, toast } = useApp();
  // An entry whose plan is the average has no budget of its own; the field starts from that figure.
  const average = entry?.source === 'average' && entry.plan > 0 ? entry.plan : null;
  const [value, setValue] = useState(entry && entry.plan > 0 ? fieldOf(entry.plan) : '');
  const [none, setNone] = useState(entry?.source === 'average');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1];

  // Typing, stepping or taking the average means you want a budget.
  const edit = (v: string) => {
    setValue(v);
    setNone(false);
    setError(null);
  };
  const step = (delta: number) => {
    const cents = parseMoney(value);
    edit(fieldOf(Math.min(MAX, Math.max(0, (Number.isNaN(cents) ? 0 : cents) + delta))));
  };
  const save = () => {
    const cents = none ? null : parseMoney(value);
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return setError('Vul een bedrag in of kies Geen budget.');
    setBusy(true);
    setError(null);
    api.setBudget({ accountId: account.id, categoryId, fromMonth: month, amount: cents }).then(
      () => {
        toast('Budget bewaard vanaf ' + monthName);
        onSaved();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <>
      <p className="pb-help">Geldt vanaf {monthName} en de maanden erna.</p>
      <div className="pb-amount">
        <button type="button" className="pb-step" aria-label="€ 10 minder" onClick={() => step(-STEP)}>
          −
        </button>
        <AmountInput label="Bedrag per maand" name="amount" value={value} onChange={edit} invalid={!!error && !none} />
        <button type="button" className="pb-step" aria-label="€ 10 meer" onClick={() => step(STEP)}>
          +
        </button>
      </div>
      {average !== null && (
        <div className="pb-avg">
          <span>
            Gemiddelde van de afgelopen 6 maanden: <b className="mono">{eur(average)}</b>
          </span>
          <button type="button" className="btn btn--secondary" onClick={() => edit(fieldOf(ceilEuro(average)))}>
            Gebruik het gemiddelde
          </button>
        </div>
      )}
      <Switch isSelected={none} onChange={(v) => { setNone(v); setError(null); }}>
        Geen budget (rekent met het gemiddelde)
      </Switch>
      {error && (
        <p className="pb-err" role="alert">
          {error}
        </p>
      )}
      {!online && <p className="pb-help">Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>}
      <div className="pb-actions">
        <Cancel onClose={onClose} />
        <button type="button" className="btn btn--primary" disabled={!online || busy} aria-busy={busy || undefined} onClick={save}>
          Opslaan
        </button>
      </div>
    </>
  );
}

/** `choices`: the categories that can get a budget but have none yet (top expense categories that are not saving); shown when the target has no row. */
export function BudgetEditor({ target, month, choices, byId, onClose, onSaved }: { target: BudgetTarget; month: string; choices: TreeCategory[]; byId: ReadonlyMap<number, TreeCategory>; onClose: () => void; onSaved: () => void }) {
  const titleId = useId();
  const [categoryId, setCategoryId] = useState<number | null>(target.entry?.categoryId ?? null);
  const category = categoryId === null ? undefined : byId.get(categoryId);
  const { account } = target;
  return (
    <Sheet onClose={onClose} labelledBy={titleId} className="pb-sheet">
      <div className="pb-head">
        <h2 className="pb-title" id={titleId}>
          {category ? 'Budget ' + category.name + ' · ' + account.name : 'Kies een categorie · ' + account.name}
        </h2>
        <SheetX className="pb-close" onClose={onClose} />
      </div>
      {category ? (
        <Form account={account} month={month} categoryId={category.id} entry={target.entry} onClose={onClose} onSaved={onSaved} />
      ) : (
        <ul className="pb-choices">
          {choices.map((c) => (
            <li key={c.id}>
              <button type="button" className="pb-choice" onClick={() => setCategoryId(c.id)}>
                <CatIcon icon={c.icon} colour={c.colour} size="lg" />
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
