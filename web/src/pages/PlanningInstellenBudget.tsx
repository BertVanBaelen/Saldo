// Planning instellen · Budgetten (plan 0.8.1-8, replaces the budget editor sheet of 0.8-6): per category of the account in view a −/+ in € 10
// steps that saves itself 800 ms after the last press, the live effect on the lowest month ("Effect op de planning"), "Terugzetten" to
// the rows of when the screen opened, "Budget toevoegen" and a remove in the row's menu. Design: the board "Planning instellen" (Budgetten).
//
// The screen calls `useBudgetEditor` once, because the tiles show every account's total; `BudgetSection` draws one account of it.
// State: `drafts` hold what a press made (the amount shown at once, `null` for a removed budget), they save per category through ONE queue
// (a PUT deletes the rows after its month, so two must never run side by side). The forecast of the opening and the budget rows of the
// opening are kept: the card compares with the first, Terugzetten restores the second.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { accColour } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { catColours } from '../lib/categories';
import { eur, eur0, MONTHS } from '../lib/format';
import type { Planning, SavedBudget } from '../lib/planning';
import { diffText, impactMonth, impactOf, restoreSequence, type BudgetChange, type Impact } from '../lib/planningImpact';
import { stateLabel } from '../lib/planningMonths';
import type { Account, Scope, TreeCategory } from '../lib/types';

/** The highest amount the server accepts (€ 1.000.000), the step of − / + and the pause before a press is saved. */
const MAX = 100_000_000;
export const STEP = 1000;
export const SAVE_DELAY_MS = 800;

const keyOf = (accountId: number, categoryId: number) => accountId + ':' + categoryId;
const ceilEuro = (cents: number) => Math.ceil(cents / 100) * 100;
const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

/** One category with a budget on an account: what is shown (`plan` includes what was just pressed), and the running month's spending and average. */
export interface BudgetLine {
  categoryId: number;
  name: string;
  colour: string;
  plan: number;
  spent: number;
  /** The 6-month average (`average` of the forecast, or the plan of a category that runs on its average); `null` when the server sent none. */
  average: number | null;
}

export interface Addable {
  category: TreeCategory;
  average: number | null;
}

export interface BudgetEditor {
  fromMonth: string;
  running: string;
  /** `null`: the account has no forecast yet (no balance), so no figures. */
  linesOf: (accountId: number) => BudgetLine[] | null;
  /** The account's budgets added up per month (cents), `null` without a forecast. */
  totalOf: (accountId: number) => number | null;
  impactOf: (accountId: number) => Impact | null;
  /** The last month of the forecast in view (`YYYY-MM`): "laagste maand tot februari". */
  lastMonthOf: (accountId: number) => string;
  /** Top expense categories (not saving) without a budget on the account. */
  addable: (accountId: number) => Addable[];
  /** Something was changed on the account since the screen opened. */
  changed: (accountId: number) => boolean;
  step: (accountId: number, categoryId: number, delta: number) => void;
  remove: (accountId: number, categoryId: number) => void;
  add: (accountId: number, categoryId: number, plan: number) => void;
  restore: (accountId: number) => void;
  /** Saves what waits for its 800 ms now (leaving the account or the screen). */
  flush: () => void;
  /** A restore is running. */
  busy: boolean;
}

interface Args {
  planning: Planning | undefined;
  /** `GET /api/planning/budgets`: the rows now; the first answer is kept as "the rows at open". */
  saved: SavedBudget[] | undefined;
  tree: TreeCategory[];
  scope: Scope;
  /** `YYYY-MM`: the month a change counts from (the running month, or the `?maand` of the Budget tab's "Aanpassen"). */
  fromMonth: string;
  /** Loads the forecast again (and the shell's alerts). */
  reload: () => void;
}

export function useBudgetEditor({ planning, saved, tree, scope, fromMonth, reload }: Args): BudgetEditor {
  const { toast, today: appToday } = useApp();
  const today = planning?.today ?? appToday;
  const running = today.slice(0, 7);
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const draftsRef = useRef(drafts);
  const timers = useRef(new Map<string, number>());
  const inflight = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The forecast and the budget rows as they were when the screen opened (per scope).
  const opened = useRef<{ scope: Scope; planning: Planning } | null>(null);
  const openRows = useRef<{ scope: Scope; rows: SavedBudget[] } | null>(null);
  if (planning && opened.current?.scope !== scope) opened.current = { scope, planning };
  if (saved && openRows.current?.scope !== scope) openRows.current = { scope, rows: saved };
  const byId = new Map(tree.map((c) => [c.id, c]));

  const setDraft = (key: string, v: number | null | undefined) => {
    const next = { ...draftsRef.current };
    if (v === undefined) delete next[key];
    else next[key] = v;
    draftsRef.current = next;
    setDrafts(next);
  };
  const touch = (key: string) => setTouched((p) => new Set(p).add(key));

  const accountPlan = (id: number) => planning?.accounts.find((a) => a.id === id);
  /** The month whose plans the rows show (the month a change counts from) and the running month (spent, average). */
  const planMonth = (id: number) => accountPlan(id)?.months.find((m) => m.month === fromMonth) ?? accountPlan(id)?.months[0];
  const runMonth = (id: number) => accountPlan(id)?.months.find((m) => m.month === running) ?? accountPlan(id)?.months[0];
  const averageOf = (id: number, categoryId: number) => {
    const e = runMonth(id)?.budgets.find((b) => b.categoryId === categoryId) ?? planMonth(id)?.budgets.find((b) => b.categoryId === categoryId);
    return e ? (e.average ?? (e.source === 'average' ? e.plan : null)) : null;
  };

  const linesOf = (id: number): BudgetLine[] | null => {
    const pm = planMonth(id);
    if (!pm) return null;
    const rm = runMonth(id);
    const ids = pm.budgets.filter((b) => b.source === 'budget').map((b) => b.categoryId);
    for (const [key, v] of Object.entries(drafts)) {
      const [a, c] = key.split(':').map(Number);
      if (a === id && v !== null && !ids.includes(c)) ids.push(c);
    }
    return ids
      .filter((c) => drafts[keyOf(id, c)] !== null)
      .map((c) => {
        const draft = drafts[keyOf(id, c)];
        const entry = pm.budgets.find((b) => b.categoryId === c);
        const cat = byId.get(c);
        return {
          categoryId: c,
          name: cat?.name ?? 'Categorie',
          colour: cat ? catColours(cat.colour).bg : 'var(--c6)',
          plan: draft ?? entry?.plan ?? 0,
          spent: rm?.budgets.find((b) => b.categoryId === c)?.spent ?? 0,
          average: averageOf(id, c),
        };
      });
  };

  /** Runs one task after the ones before it. */
  const enqueue = (task: () => Promise<void>) => {
    queue.current = queue.current.then(task, task);
    return queue.current;
  };
  const save = (key: string) => {
    const amount = draftsRef.current[key];
    if (amount === undefined) return;
    const [accountId, categoryId] = key.split(':').map(Number);
    inflight.current.add(key);
    void enqueue(async () => {
      try {
        await api.setBudget({ accountId, categoryId, fromMonth, amount });
        const name = byId.get(categoryId)?.name ?? 'Categorie';
        toast(amount === null ? 'Budget ' + name + ' verwijderd · de planning rekent met het gemiddelde' : 'Budget ' + name + ': ' + eur0(amount) + ' vanaf ' + monthName(fromMonth));
        reload();
      } catch (e) {
        // A newer press (another amount, or its save still waiting) keeps its draft: only the draft this save sent goes.
        if (draftsRef.current[key] === amount && !timers.current.has(key)) setDraft(key, undefined);
        toast(errorMessage(e));
      } finally {
        inflight.current.delete(key);
      }
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const schedule = (key: string, delay: number) => {
    window.clearTimeout(timers.current.get(key));
    if (delay === 0) {
      timers.current.delete(key);
      saveRef.current(key);
      return;
    }
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        saveRef.current(key);
      }, delay),
    );
  };
  const flush = () => {
    for (const [key, t] of [...timers.current]) {
      window.clearTimeout(t);
      timers.current.delete(key);
      save(key);
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Leaving the screen saves what waits for its pause.
  useEffect(() => () => flushRef.current(), []);

  // An answer that has caught up with a draft makes it superfluous (it only hides what the server says).
  useEffect(() => {
    if (!planning) return;
    for (const [key, v] of Object.entries(draftsRef.current)) {
      if (timers.current.has(key) || inflight.current.has(key)) continue;
      const [a, c] = key.split(':').map(Number);
      const entry = planning.accounts.find((x) => x.id === a)?.months.find((m) => m.month === fromMonth)?.budgets.find((b) => b.categoryId === c);
      if (v === null ? entry?.source !== 'budget' : entry?.source === 'budget' && entry.plan === v) setDraft(key, undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning]);

  const step = (accountId: number, categoryId: number, delta: number) => {
    const key = keyOf(accountId, categoryId);
    // From what the last press made (the ref is current even before React has drawn it), else from the forecast.
    const now = draftsRef.current[key] ?? planMonth(accountId)?.budgets.find((b) => b.categoryId === categoryId)?.plan ?? 0;
    setDraft(key, Math.min(MAX, Math.max(0, now + delta)));
    touch(key);
    schedule(key, SAVE_DELAY_MS);
  };
  const remove = (accountId: number, categoryId: number) => {
    const key = keyOf(accountId, categoryId);
    setDraft(key, null);
    touch(key);
    schedule(key, 0);
  };
  const add = (accountId: number, categoryId: number, plan: number) => {
    const key = keyOf(accountId, categoryId);
    setDraft(key, Math.min(MAX, plan));
    touch(key);
    schedule(key, 0);
  };

  /** Every changed category of the account back to the rows of the opening: the pending presses are dropped first, then one request after the other. */
  const restore = (accountId: number) => {
    const rows = openRows.current?.rows;
    if (!rows || busy) return;
    const keys = [...touched].filter((k) => k.startsWith(accountId + ':'));
    for (const key of keys) {
      window.clearTimeout(timers.current.get(key));
      timers.current.delete(key);
    }
    setBusy(true);
    void enqueue(async () => {
      try {
        for (const key of keys) {
          const categoryId = Number(key.split(':')[1]);
          for (const put of restoreSequence(rows, accountId, categoryId, running)) await api.setBudget(put);
        }
        setTouched((p) => new Set([...p].filter((k) => !keys.includes(k))));
        toast('Budgetten teruggezet');
      } catch (e) {
        toast(errorMessage(e));
      } finally {
        // Whatever the outcome the server's rows are the truth now: the drafts go, the forecast loads again.
        for (const key of keys) setDraft(key, undefined);
        setBusy(false);
        reload();
      }
    });
  };

  const changesOf = (accountId: number): BudgetChange[] =>
    Object.entries(drafts).flatMap(([key, v]) => {
      const [a, c] = key.split(':').map(Number);
      if (a !== accountId) return [];
      // A removed budget falls back to the average (nothing to say when there is none).
      const plan = v ?? averageOf(accountId, c);
      return plan === null ? [] : [{ categoryId: c, plan }];
    });

  return {
    fromMonth,
    running,
    linesOf,
    totalOf: (id) => linesOf(id)?.reduce((s, l) => s + l.plan, 0) ?? null,
    impactOf: (id) => {
      const p = accountPlan(id);
      return p ? impactOf(p, changesOf(id), fromMonth, today, opened.current?.planning.accounts.find((a) => a.id === id) ?? p) : null;
    },
    lastMonthOf: (id) => accountPlan(id)?.months.at(-1)?.month ?? running,
    addable: (id) => {
      const have = new Set((linesOf(id) ?? []).map((l) => l.categoryId));
      return tree
        .filter((c) => c.parentId === null && c.type === 'expense' && !c.saving && !have.has(c.id))
        .map((category) => ({ category, average: averageOf(id, category.id) }));
    },
    changed: (id) => [...touched].some((k) => k.startsWith(id + ':')),
    step,
    remove,
    add,
    restore,
    flush,
    busy,
  };
}

/** One account's Budgetten section. `editable`: the viewer may edit the account (without it no −/+, no menu, no buttons: the lists and the card still show). */
export function BudgetSection({ account, editor, editable }: { account: Account; editor: BudgetEditor; editable: boolean }) {
  const { online } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const lines = editor.linesOf(account.id);
  const impact = editor.impactOf(account.id);
  const forecast = lines !== null;
  const can = editable && online;

  if (!forecast) {
    return (
      <div className="in-stack">
        <p className="in-note">Nog geen saldo voor {account.name}. De budgetten verschijnen zodra er een saldo is.</p>
      </div>
    );
  }

  const addable = editor.addable(account.id);
  const total = editor.totalOf(account.id) ?? 0;
  const last = monthName(editor.lastMonthOf(account.id));
  return (
    <div className="in-stack">
      {editor.fromMonth !== editor.running && (
        <p className="in-note">
          Geldt vanaf {monthName(editor.fromMonth)} {editor.fromMonth.slice(0, 4)} en de maanden erna.
        </p>
      )}
      {impact && (
        <section className="in-card in-impact" aria-label="Effect op de planning" aria-live="polite">
          <span className="in-impact-title">Effect op de planning · laagste maand tot {last}</span>
          <div className="in-impact-row">
            <span className="in-impact-dot" style={{ background: accColour(account.colour) }} aria-hidden="true" />
            <span className="in-impact-text">
              <span className="in-impact-name">{account.name}</span>
              <span className="in-impact-sub">
                {impactMonth(impact.month)} · {diffText(impact.diff)}
              </span>
            </span>
            <span className="mono in-impact-value">{eur(impact.end)}</span>
            <span className={'in-chip in-chip--' + impact.state}>{stateLabel(impact.state)}</span>
          </div>
        </section>
      )}
      <div className="in-card in-rows">
        {lines.map((l) => {
          const pct = l.plan ? Math.min(100, Math.round((l.spent / l.plan) * 100)) : 0;
          return (
            <div className="in-brow" key={l.categoryId}>
              <div className="in-brow-top">
                <i className="in-dot" style={{ background: l.colour }} aria-hidden="true" />
                <span className="in-brow-name">{l.name}</span>
                {editable ? (
                  <div className="in-stepper" role="group" aria-label={l.name + ': budget ' + eur0(l.plan) + ' per maand'}>
                    <button type="button" className="in-step" aria-label="€ 10 minder" disabled={!can || l.plan <= 0} onClick={() => editor.step(account.id, l.categoryId, -STEP)}>
                      −
                    </button>
                    <span className="mono in-amount">{eur0(l.plan)}</span>
                    <button type="button" className="in-step" aria-label="€ 10 meer" disabled={!can} onClick={() => editor.step(account.id, l.categoryId, STEP)}>
                      +
                    </button>
                  </div>
                ) : (
                  <span className="mono in-amount in-amount--read">{eur0(l.plan)}</span>
                )}
              </div>
              <span className="in-track" aria-hidden="true">
                <span className="in-fill" style={{ width: pct + '%', background: l.spent > l.plan ? 'var(--neg)' : l.colour }} />
              </span>
              <div className="in-brow-foot">
                <span className="in-brow-note">{eur0(l.spent) + ' besteed deze maand' + (l.average !== null ? ' · gemiddeld ' + eur0(l.average) : '')}</span>
                {editable && (
                  <button type="button" className="in-more" aria-label={'Meer voor ' + l.name} aria-haspopup="menu" aria-expanded={menu === l.categoryId} disabled={!online} onClick={() => setMenu(menu === l.categoryId ? null : l.categoryId)}>
                    <Icon name="more" size={18} stroke={3} />
                  </button>
                )}
              </div>
              {menu === l.categoryId && (
                <div
                  className="in-menu"
                  role="menu"
                  aria-label={'Opties voor ' + l.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenu(null);
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="in-menu-item"
                    autoFocus
                    onClick={() => {
                      setMenu(null);
                      editor.remove(account.id, l.categoryId);
                    }}
                  >
                    Verwijderen
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {lines.length === 0 && <p className="in-empty">Nog geen budgetten voor {account.name}.</p>}
        <div className="in-total">
          <span>Totaal per maand</span>
          <span className="mono">{eur0(total)}</span>
        </div>
      </div>
      {addOpen && editable && (
        <div className="in-card in-add">
          <span className="in-add-title">Categorieën zonder budget</span>
          {addable.map(({ category, average }) => (
            <button
              type="button"
              className="in-add-row"
              key={category.id}
              disabled={!can}
              onClick={() => {
                setAddOpen(false);
                editor.add(account.id, category.id, average === null ? 0 : ceilEuro(average));
              }}
            >
              <span className="in-add-text">
                <span className="in-add-name">{category.name}</span>
                <span className="in-brow-note">{average === null ? 'Nog geen gemiddelde' : 'Gemiddeld ' + eur0(average) + ' per maand'}</span>
              </span>
              <Icon name="plus" size={16} stroke={2.6} />
            </button>
          ))}
          {addable.length === 0 && <p className="in-empty">Alle categorieën hebben een budget.</p>}
        </div>
      )}
      {editable && (
        <div className={'in-actions' + (editor.changed(account.id) ? ' in-actions--two' : '')}>
          <button type="button" className="btn btn--dashed" aria-expanded={addOpen} disabled={!can} onClick={() => setAddOpen((v) => !v)}>
            <Icon name="plus" size={16} stroke={2.6} />
            Budget toevoegen
          </button>
          {editor.changed(account.id) && (
            <button type="button" className="btn btn--ghost in-reset" disabled={!can || editor.busy} aria-busy={editor.busy || undefined} onClick={() => editor.restore(account.id)}>
              Terugzetten
            </button>
          )}
        </div>
      )}
      {editable && !online && <p className="in-note">Je bent offline. Aanpassen kan weer zodra je verbinding hebt.</p>}
      <p className="in-note">Zonder budget rekent de planning met het gemiddelde van de laatste 6 maanden. Vaste kosten zoals huur en abonnementen staan bij Terugkerend.</p>
    </div>
  );
}

