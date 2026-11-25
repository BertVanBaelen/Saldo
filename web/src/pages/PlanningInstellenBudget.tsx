// Planning instellen · Budgetten (plan 0.8.1-8, replaces the budget editor sheet of 0.8-6): per category of the account in view a −/+ in € 10
// steps that saves itself 800 ms after the last press, the live effect on the lowest month ("Effect op de planning"), "Terugzetten" to
// the rows of when the screen opened, "Budget toevoegen" and a remove in the row's menu. Design: the board "Planning instellen" (Budgetten).
//
// Plan 0.9.1-5a: the budget is the TOTAL of the month. The rows read Vast (recurring costs assigned to the category) + Extra (what the plan
// spreads on top) = Totaal for the month in the stepper; − / + change the total from that month onward; the two warnings (total below the
// month's fixed costs, below the 6-month average) show on the row only (lib/budgetTotal.ts).
//
// Plan 0.9.1-5b: "Zonder categorie" lists the account's confirmed expense items without a category with the suggestion of their payments as a
// chip. The chip previews the assignment in the strip (`AssignChange`: the total stays, the extra shrinks); "Toewijzen" sends it, "Kies…" opens
// the item sheet on its category field. Nothing is assigned without the user's tap.
//
// The screen calls `useBudgetEditor` once, because the tiles show every account's total; `BudgetSection` draws one account of it.
// State: `drafts` hold what a press made (the total shown at once, `null` for a removed budget), they save per category through ONE queue
// (a PUT deletes the rows after its month, so two must never run side by side). The forecast of the opening and the budget rows of the
// opening are kept: the card compares with the first, Terugzetten restores the second.
import { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { accColour } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { assignedItems, budgetWarnings, monthlyFixed, topOf, uncategorised } from '../lib/budgetTotal';
import { catColours, categoryLabel } from '../lib/categories';
import { eur, eur0, MONTHS } from '../lib/format';
import type { PlanBudget, Planning, SavedBudget } from '../lib/planning';
import { diffText, impactMonth, impactOf, restoreSequence, type AssignChange, type BudgetChange, type Impact } from '../lib/planningImpact';
import { categoryFits, itemRhythm, monthYear, type RecurringItem } from '../lib/planningItems';
import { stateLabel } from '../lib/planningMonths';
import type { Account, Scope, TreeCategory } from '../lib/types';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { ItemForm } from './PlanningItemForm';
import { addMonths, monthOffset } from './planningTabs';

/** The highest amount the server accepts (€ 1.000.000), the step of − / + and the pause before a press is saved. */
const MAX = 100_000_000;
export const STEP = 1000;
export const SAVE_DELAY_MS = 800;

const keyOf = (accountId: number, categoryId: number) => accountId + ':' + categoryId;
const ceilEuro = (cents: number) => Math.ceil(cents / 100) * 100;
const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

/** One category with a budget on an account, for the month in view: the total shown (it includes what was just pressed), its fixed costs, the extra on top and the running month's spending. */
export interface BudgetLine {
  categoryId: number;
  name: string;
  colour: string;
  /** What − / + change: the budget of the month, fixed costs included. */
  total: number;
  /** The month's occurrences of the expense items assigned to the category ("Vast"); 0 when none. */
  recurring: number;
  /** "Extra": `max(0, total − recurring)`, what the plan spreads. */
  plan: number;
  /** Variable spending of the running month. */
  spent: number;
}

export interface Addable {
  category: TreeCategory;
  /** The variable 6-month average of the forecast (`average`, or the plan of a category that runs on its average); `null` when the server sent none. */
  average: number | null;
  /** What its monthly recurring items cost per month (`monthlyFixed`). */
  fixed: number;
  /** The month's recurring costs in view; above 0 the category is also listed under "Vaste kosten zonder budget". */
  recurring: number;
}

export interface BudgetEditor {
  fromMonth: string;
  running: string;
  /** `null`: the account has no forecast yet (no balance), so no figures. */
  linesOf: (accountId: number) => BudgetLine[] | null;
  /** The account's budgets added up per month (cents), `null` without a forecast. */
  totalOf: (accountId: number) => number | null;
  /** The strip: the budget presses of the account, plus `assign`, the assignment of "Zonder categorie" that is being previewed (0.9.1-5b). */
  impactOf: (accountId: number, assign?: AssignChange | null) => Impact | null;
  /** The account's confirmed expense items without a category. */
  uncategorised: (accountId: number) => RecurringItem[];
  /** The last month of the forecast in view (`YYYY-MM`): "laagste maand tot februari". */
  lastMonthOf: (accountId: number) => string;
  /** Top expense categories (not saving) without a budget on the account. */
  addable: (accountId: number) => Addable[];
  /** The account's confirmed expense items assigned to the category (or a subcategory of it) that fall in the month in view. */
  assigned: (accountId: number, categoryId: number) => RecurringItem[];
  /** Something was changed on the account since the screen opened. */
  changed: (accountId: number) => boolean;
  step: (accountId: number, categoryId: number, delta: number) => void;
  remove: (accountId: number, categoryId: number) => void;
  add: (accountId: number, categoryId: number, total: number) => void;
  restore: (accountId: number) => void;
  /** Saves what waits for its 800 ms now (leaving the account, the month or the screen). */
  flush: () => void;
  /** Drops what a press made, after `flush`: a draft belongs to the month it was made in, and the rows are about to show another one. */
  forget: () => void;
  /** A restore is running. */
  busy: boolean;
}

interface Args {
  planning: Planning | undefined;
  /** `GET /api/planning/budgets`: the rows now; the first answer is kept as "the rows at open". */
  saved: SavedBudget[] | undefined;
  tree: TreeCategory[];
  /** `GET /api/planning/items`: the items behind "Vast" and the prefill of "Budget toevoegen". */
  items: RecurringItem[];
  scope: Scope;
  /** `YYYY-MM`: the month a change counts from (the running month, or the `?maand` of the Budget tab's "Aanpassen"). */
  fromMonth: string;
  /** Loads the forecast again (and the shell's alerts). */
  reload: () => void;
}

export function useBudgetEditor({ planning, saved, tree, items, scope, fromMonth, reload }: Args): BudgetEditor {
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
  /** The month whose plans the rows show (the month a change counts from) and the running month (spent, the average of a category without a budget). */
  const planMonth = (id: number) => accountPlan(id)?.months.find((m) => m.month === fromMonth) ?? accountPlan(id)?.months[0];
  const runMonth = (id: number) => accountPlan(id)?.months.find((m) => m.month === running) ?? accountPlan(id)?.months[0];
  const averageOf = (id: number, categoryId: number) => {
    const e = runMonth(id)?.budgets.find((b) => b.categoryId === categoryId) ?? planMonth(id)?.budgets.find((b) => b.categoryId === categoryId);
    return e ? (e.average ?? (e.source === 'average' ? e.plan : null)) : null;
  };

  /** The total of a forecast entry (`plan` for an answer that carries no `total`). */
  const totalIn = (e: PlanBudget | undefined) => e?.total ?? e?.plan ?? 0;

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
        const total = draft ?? totalIn(entry);
        const recurring = entry?.recurring ?? 0;
        return {
          categoryId: c,
          name: cat?.name ?? 'Categorie',
          colour: cat ? catColours(cat.colour).bg : 'var(--c6)',
          total,
          recurring,
          plan: Math.max(0, total - recurring),
          spent: rm?.budgets.find((b) => b.categoryId === c)?.spent ?? 0,
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
      if (v === null ? entry?.source !== 'budget' : entry?.source === 'budget' && totalIn(entry) === v) setDraft(key, undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning]);

  const step = (accountId: number, categoryId: number, delta: number) => {
    const key = keyOf(accountId, categoryId);
    // From what the last press made (the ref is current even before React has drawn it), else from the forecast.
    const now = draftsRef.current[key] ?? totalIn(planMonth(accountId)?.budgets.find((b) => b.categoryId === categoryId));
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
  const add = (accountId: number, categoryId: number, total: number) => {
    const key = keyOf(accountId, categoryId);
    setDraft(key, Math.min(MAX, total));
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
    Object.entries(drafts).flatMap<BudgetChange>(([key, v]) => {
      const [a, c] = key.split(':').map(Number);
      if (a !== accountId) return [];
      if (v !== null) return [{ categoryId: c, total: v }];
      // A removed budget falls back to the average (nothing to say when there is none).
      const average = averageOf(accountId, c);
      return average === null ? [] : [{ categoryId: c, total: null, average }];
    });

  return {
    fromMonth,
    running,
    linesOf,
    totalOf: (id) => linesOf(id)?.reduce((s, l) => s + l.total, 0) ?? null,
    impactOf: (id, assign) => {
      const p = accountPlan(id);
      return p ? impactOf(p, [...changesOf(id), ...(assign ? [assign] : [])], fromMonth, today, opened.current?.planning.accounts.find((a) => a.id === id) ?? p) : null;
    },
    uncategorised: (id) => uncategorised(items, id),
    lastMonthOf: (id) => accountPlan(id)?.months.at(-1)?.month ?? running,
    addable: (id) => {
      const have = new Set((linesOf(id) ?? []).map((l) => l.categoryId));
      return tree
        .filter((c) => c.parentId === null && c.type === 'expense' && !c.saving && !have.has(c.id))
        .map((category) => ({
          category,
          average: averageOf(id, category.id),
          fixed: monthlyFixed(items, id, category.id, tree, running),
          recurring: planMonth(id)?.budgets.find((b) => b.categoryId === category.id)?.recurring ?? 0,
        }));
    },
    assigned: (id, categoryId) => assignedItems(items, id, categoryId, tree, fromMonth),
    changed: (id) => [...touched].some((k) => k.startsWith(id + ':')),
    step,
    remove,
    add,
    restore,
    flush,
    forget: () => {
      draftsRef.current = {};
      setDrafts({});
    },
    busy,
  };
}

/** "‹ november 2026 ›": the month the rows and a change count from, the running month to 24 months on. */
export function MonthStepper({ month, running, onMonth }: { month: string; running: string; onMonth: (month: string) => void }) {
  return (
    <div className="pin-mnav" role="group" aria-label="Maand">
      <button type="button" className="pin-mnav-btn" aria-label="Vorige maand" disabled={month <= running} onClick={() => onMonth(addMonths(month, -1))}>
        <Icon name="back" size={18} stroke={2.4} />
      </button>
      <span className="pin-mnav-name" aria-live="polite">
        {monthYear(month)}
      </span>
      <button type="button" className="pin-mnav-btn" aria-label="Volgende maand" disabled={monthOffset(running, month) >= 24} onClick={() => onMonth(addMonths(month, 1))}>
        <Icon name="chevron" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

/** What a new budget starts at: the monthly fixed costs plus the variable average, rounded up to whole euros (README decision 14; the same in every month in view). */
const prefill = (a: Addable) => ceilEuro(a.fixed + (a.average ?? 0));

/** One account's Budgetten section. `editable`: the viewer may edit the account (without it no −/+, no menu, no buttons: the lists and the card still show). `tree` and `onItemSaved` serve the item sheet that opens from the items behind "Vast". */
export function BudgetSection({ account, editor, editable, tree, onItemSaved }: { account: Account; editor: BudgetEditor; editable: boolean; tree: AsyncState<TreeCategory[]>; onItemSaved: () => void }) {
  const { online, scope, today, dataVersion, toast } = useApp();
  const uid = useId();
  const [addOpen, setAddOpen] = useState(false);
  /** The item of "Zonder categorie" whose assignment the strip previews, and the one being saved. */
  const [preview, setPreview] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  /** The category whose row of the "Budget toevoegen" list takes focus (a tap on "Vaste kosten zonder budget"). */
  const [pick, setPick] = useState<number | null>(null);
  const addRows = useRef(new Map<number, HTMLButtonElement>());
  const [menu, setMenu] = useState<number | null>(null);
  /** The categories whose "Vaste kosten" list is open. */
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  /** The item sheet: from the items behind "Vast", or from "Kies…" of "Zonder categorie" (`pick`: with the category picker open). */
  const [form, setForm] = useState<{ item: RecurringItem; pick: boolean } | null>(null);
  // The full-amount 6-month average per category (the numbers of Overzicht) for "gemiddeld" and the average warning: while it loads or fails, both are left out.
  const reference = useAsync((signal) => api.reportBudgets({ scope, account: account.id, from: editor.running, to: editor.running, average: true }, signal), [scope, account.id, editor.running, dataVersion]);
  useEffect(() => {
    if (pick === null || !addOpen) return;
    addRows.current.get(pick)?.focus();
    setPick(null);
  }, [pick, addOpen]);
  const lines = editor.linesOf(account.id);
  const byId = new Map((tree.data ?? []).map((c) => [c.id, c]));
  const todo = editor.uncategorised(account.id);
  /** The category the payments of an item suggest, when the tree knows it and it fits the item (an expense category that is not saving); otherwise "Kies…". */
  const suggestion = (i: RecurringItem) => {
    const c = i.suggestedCategoryId == null ? undefined : byId.get(i.suggestedCategoryId);
    return c && categoryFits(i.kind, c) ? c : undefined;
  };
  // The strip: assigning from none to the TOP of the suggestion (the forecast's entries are per top category); the request sends the suggestion itself.
  const previewed = todo.find((i) => i.id === preview);
  const target = previewed && suggestion(previewed);
  const impact = editor.impactOf(account.id, previewed && target ? { item: previewed, from: null, to: topOf(target.id, tree.data ?? []) } : null);
  const forecast = lines !== null;
  const can = editable && online;

  if (!forecast) {
    return (
      <div className="pin-stack">
        <p className="pin-note">Nog geen saldo voor {account.name}. De budgetten verschijnen zodra er een saldo is.</p>
      </div>
    );
  }

  const averages = new Map((reference.data?.months.flatMap((m) => m.accounts).find((a) => a.id === account.id)?.categories ?? []).map((c) => [c.categoryId, c.average ?? null]));
  const addable = editor.addable(account.id);
  const fixedOnly = addable.filter((a) => a.recurring > 0);
  const total = editor.totalOf(account.id) ?? 0;
  const last = monthName(editor.lastMonthOf(account.id));
  const inRunning = editor.fromMonth === editor.running;
  /** "Toewijzen": the item takes the suggested category; the preview goes at once (the reload that follows already counts the item there) and the strip then shows the engine's answer. */
  const assign = (item: RecurringItem, category: TreeCategory) => {
    setAssigning(item.id);
    api.updatePlanningItem(item.id, { categoryId: category.id }).then(
      () => {
        toast(item.description + ' telt nu bij ' + categoryLabel(category, byId));
        setPreview(null);
        onItemSaved();
      },
      (e) => toast(errorMessage(e)),
    ).finally(() => setAssigning(null));
  };
  return (
    <div className="pin-stack">
      {!inRunning && (
        <p className="pin-note">
          Geldt vanaf {monthName(editor.fromMonth)} {editor.fromMonth.slice(0, 4)} en de maanden erna.
        </p>
      )}
      {impact && (
        <section className="pin-card pin-impact" aria-label="Effect op de planning" aria-live="polite">
          <span className="pin-impact-title">Effect op de planning · laagste maand tot {last}</span>
          <div className="pin-impact-row">
            <span className="pin-impact-dot" style={{ background: accColour(account.colour) }} aria-hidden="true" />
            <span className="pin-impact-text">
              <span className="pin-impact-name">{account.name}</span>
              <span className="pin-impact-sub">
                {impactMonth(impact.month)} · {diffText(impact.diff)}
              </span>
            </span>
            <span className="mono pin-impact-value">{eur(impact.end)}</span>
            <span className={'pin-chip pin-chip--' + impact.state}>{stateLabel(impact.state)}</span>
          </div>
        </section>
      )}
      <div className="pin-card pin-rows">
        {lines.map((l) => {
          const average = averages.get(l.categoryId) ?? null;
          const warnings = budgetWarnings(l.total, l.recurring, average, editor.fromMonth);
          // The bar is the running month's variable spending against the extra (Overzicht reads everything booked against the total).
          const over = l.spent > l.plan;
          const pct = over ? 100 : l.plan === 0 ? 0 : Math.round((l.spent / l.plan) * 100);
          const note = [inRunning && eur0(l.spent) + ' besteed deze maand', average !== null && 'gemiddeld ' + eur0(average)].filter(Boolean).join(' · ');
          const items = editor.assigned(account.id, l.categoryId);
          const itemsId = uid + '-items-' + l.categoryId;
          const open = shown.has(l.categoryId);
          return (
            <div className="pin-brow" key={l.categoryId}>
              <div className="pin-brow-top">
                <i className="pin-dot" style={{ background: l.colour }} aria-hidden="true" />
                <span className="pin-brow-name">{l.name}</span>
                {editable ? (
                  <div className="pin-stepper" role="group" aria-label={l.name + ': budget ' + eur0(l.total) + ' per maand'}>
                    <button type="button" className="pin-step" aria-label="€ 10 minder" disabled={!can || l.total <= 0} onClick={() => editor.step(account.id, l.categoryId, -STEP)}>
                      −
                    </button>
                    <span className="mono pin-amount">{eur0(l.total)}</span>
                    <button type="button" className="pin-step" aria-label="€ 10 meer" disabled={!can} onClick={() => editor.step(account.id, l.categoryId, STEP)}>
                      +
                    </button>
                  </div>
                ) : (
                  <span className="mono pin-amount pin-amount--read">{eur0(l.total)}</span>
                )}
              </div>
              {l.recurring > 0 && <span className="pin-brow-sum">{'Vast ' + eur0(l.recurring) + ' + Extra ' + eur0(l.plan) + ' = ' + eur0(l.recurring + l.plan)}</span>}
              {warnings.map((w) => (
                <p className="pin-brow-warn" role="note" key={w}>
                  {w}
                </p>
              ))}
              {inRunning && (
                <span className="pin-track" aria-hidden="true">
                  <span className="pin-fill" style={{ width: pct + '%', background: over ? 'var(--neg)' : l.colour }} />
                </span>
              )}
              <div className="pin-brow-foot">
                <span className="pin-brow-note">{note}</span>
                {editable && (
                  <button type="button" className="pin-more" aria-label={'Meer voor ' + l.name} aria-haspopup="menu" aria-expanded={menu === l.categoryId} disabled={!online} onClick={() => setMenu(menu === l.categoryId ? null : l.categoryId)}>
                    <Icon name="more" size={18} stroke={3} />
                  </button>
                )}
              </div>
              {menu === l.categoryId && (
                <div
                  className="pin-menu"
                  role="menu"
                  aria-label={'Opties voor ' + l.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenu(null);
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="pin-menu-item"
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
              {items.length > 0 && (
                <>
                  <button
                    type="button"
                    className="pl-fold"
                    aria-expanded={open}
                    aria-controls={itemsId}
                    onClick={() =>
                      setShown((p) => {
                        const next = new Set(p);
                        if (!next.delete(l.categoryId)) next.add(l.categoryId);
                        return next;
                      })
                    }
                  >
                    Vaste kosten ({items.length})
                    <Icon name="chevron" size={16} stroke={2.4} />
                  </button>
                  {open && (
                    <ul className="pl-recs" id={itemsId}>
                      {items.map((item) => {
                        const suggested = item.suggestedCategoryId == null ? undefined : byId.get(item.suggestedCategoryId);
                        const text = (
                          <span className="pl-rec-main">
                            <span className="pl-rec-name">{item.description}</span>
                            <span className="pl-rec-sub">{itemRhythm(item)}</span>
                            {suggested && item.categoryId !== suggested.id && <span className="pl-rec-sub">Betalingen staan meestal in {categoryLabel(suggested, byId)}</span>}
                          </span>
                        );
                        const amount = <span className="mono pl-rec-amount">{eur(item.amount, true)}</span>;
                        return (
                          <li key={item.id}>
                            {editable ? (
                              <button type="button" className="pl-rec" aria-haspopup="dialog" onClick={() => setForm({ item, pick: false })}>
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
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          );
        })}
        {lines.length === 0 && <p className="pin-empty">Nog geen budgetten voor {account.name}.</p>}
        <div className="pin-total">
          <span>Totaal per maand</span>
          <span className="mono">{eur0(total)}</span>
        </div>
      </div>
      {fixedOnly.length > 0 && (
        <div className="pin-card pin-add">
          <span className="pin-add-title">Vaste kosten zonder budget</span>
          {fixedOnly.map(({ category, recurring }) => {
            const text = (
              <span className="pin-add-text">
                <span className="pin-add-name">{category.name}</span>
                <span className="pin-brow-note">{'Vast ' + eur0(recurring) + ' · geen budget'}</span>
              </span>
            );
            return editable ? (
              <button
                type="button"
                className="pin-add-row"
                key={category.id}
                disabled={!can}
                onClick={() => {
                  setPick(category.id);
                  setAddOpen(true);
                }}
              >
                {text}
                <Icon name="plus" size={16} stroke={2.6} />
              </button>
            ) : (
              <div className="pin-add-row" key={category.id}>
                {text}
              </div>
            );
          })}
        </div>
      )}
      {todo.length > 0 && (
        <div className="pin-card pin-add">
          <span className="pin-add-title">Zonder categorie · telt in geen budget</span>
          <ul className="pl-recs">
            {todo.map((item) => {
              const suggested = suggestion(item);
              const label = suggested ? categoryLabel(suggested, byId) : '';
              const open = preview === item.id;
              const busy = assigning === item.id;
              const chipId = uid + '-chip-' + item.id;
              return (
                <li key={item.id}>
                  <div className="pl-rec">
                    <span className="pl-rec-main">
                      <span className="pl-rec-name">{item.description}</span>
                      <span className="pl-rec-sub">{itemRhythm(item)}</span>
                    </span>
                    <span className="mono pl-rec-amount">{eur(item.amount, true)}</span>
                  </div>
                  {editable && (
                    <div className="pin-uncat">
                      {suggested ? (
                        <>
                          <button type="button" className="pi-chip" id={chipId} aria-pressed={open} aria-label={label + ' voor ' + item.description} disabled={!can || busy} onClick={() => setPreview(open ? null : item.id)}>
                            {label}
                          </button>
                          {open && (
                            <>
                              <button type="button" className="btn btn--primary pl-btn-sm" aria-label={'Toewijzen: ' + item.description} disabled={!can || busy} aria-busy={busy || undefined} onClick={() => assign(item, suggested)}>
                                Toewijzen
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost pl-btn-sm"
                                aria-label={'Annuleren: ' + item.description}
                                disabled={busy}
                                onClick={() => {
                                  setPreview(null);
                                  document.getElementById(chipId)?.focus();
                                }}
                              >
                                Annuleren
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <button type="button" className="pi-chip" aria-label={'Kies… voor ' + item.description} aria-haspopup="dialog" disabled={!can} onClick={() => setForm({ item, pick: true })}>
                          Kies…
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {addOpen && editable && (
        <div className="pin-card pin-add">
          <span className="pin-add-title">Categorieën zonder budget</span>
          {addable.map((a) => (
            <button
              type="button"
              className="pin-add-row"
              key={a.category.id}
              ref={(el) => {
                if (el) addRows.current.set(a.category.id, el);
                else addRows.current.delete(a.category.id);
              }}
              disabled={!can}
              onClick={() => {
                setAddOpen(false);
                editor.add(account.id, a.category.id, prefill(a));
              }}
            >
              <span className="pin-add-text">
                <span className="pin-add-name">{a.category.name}</span>
                <span className="pin-brow-note">
                  {a.fixed > 0
                    ? 'Vast ' + eur0(a.fixed) + ' per maand' + (a.average === null ? '' : ' · gemiddeld ' + eur0(a.average))
                    : a.average === null
                      ? 'Nog geen gemiddelde'
                      : 'Gemiddeld ' + eur0(a.average) + ' per maand'}
                </span>
              </span>
              <Icon name="plus" size={16} stroke={2.6} />
            </button>
          ))}
          {addable.length === 0 && <p className="pin-empty">Alle categorieën hebben een budget.</p>}
        </div>
      )}
      {editable && (
        <div className={'pin-actions' + (editor.changed(account.id) ? ' pin-actions--two' : '')}>
          <button type="button" className="btn btn--dashed" aria-expanded={addOpen} disabled={!can} onClick={() => setAddOpen((v) => !v)}>
            <Icon name="plus" size={16} stroke={2.6} />
            Budget toevoegen
          </button>
          {editor.changed(account.id) && (
            <button type="button" className="btn btn--ghost pin-reset" disabled={!can || editor.busy} aria-busy={editor.busy || undefined} onClick={() => editor.restore(account.id)}>
              Terugzetten
            </button>
          )}
        </div>
      )}
      {editable && !online && <p className="pin-note">Je bent offline. Aanpassen kan weer zodra je verbinding hebt.</p>}
      <p className="pin-note">Een budget is het totaal per maand: de vaste kosten met deze categorie plus wat je daarnaast uitgeeft. Een wijziging geldt vanaf de gekozen maand. De balk toont wat je naast de vaste kosten uitgaf, tegenover het extra. Zonder budget rekent de planning met het gemiddelde van de laatste 6 maanden.</p>
      {form && (
        <ItemForm
          mode={{ type: 'edit', item: form.item }}
          pickCategory={form.pick}
          accounts={[account]}
          today={today}
          tree={tree}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            onItemSaved();
          }}
        />
      )}
    </div>
  );
}
