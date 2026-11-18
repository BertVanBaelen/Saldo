// The shared shell of the Planning tabs (plan 0.8-5): the props every tab component takes, and the month arithmetic of the URL
// state (`?maand=YYYY-MM`, the horizon it needs).
//
// RULE for the tab files (Kalender, Maanden, Terugkerend, Eenmalig, Budget): the exported component must be hook-free and return
// only `<TabPanel id="…" className="pl-panel"><Body {...props} /></TabPanel>`. React Aria's `Tabs` renders its children a second time
// in a hidden tree to collect the tabs; a hideable `TabPanel` renders nothing there, but a wrapper around it still runs its hooks and
// effects in that copy. State, effects and data loading therefore live in `Body`, which only mounts for the selected tab.
import type { Horizon, Planning } from '../lib/planning';
import type { Account, Scope } from '../lib/types';

export type PlanningTabId = 'kalender' | 'maanden' | 'terugkerend' | 'eenmalig' | 'budget';

export const TABS: { id: PlanningTabId; label: string }[] = [
  { id: 'kalender', label: 'Kalender' },
  { id: 'maanden', label: 'Maanden' },
  { id: 'terugkerend', label: 'Terugkerend' },
  { id: 'eenmalig', label: 'Eenmalig' },
  { id: 'budget', label: 'Budget' },
];

export interface PlanningTabProps {
  /** The forecast for the scope, horizon and month in the URL (`GET /api/planning`); `undefined` while that answer loads, so a tab stays mounted (focus, open cards) across a horizon or month change. */
  planning: Planning | undefined;
  /** The current accounts in view, in `GET /api/accounts` order: name, colour, kind and the viewer's `permission` (the forecast carries none of them). */
  accounts: Account[];
  scope: Scope;
  /** `YYYY-MM`: the month of the Kalender, the Budget tab and the Maanden detail. Always inside the forecast. */
  month: string;
  setMonth: (month: string) => void;
  /** The horizon the answer was asked with (months after the running month). The Maanden tab picks it. */
  horizon: Horizon;
  setHorizon: (horizon: Horizon) => void;
  /** Load the forecast again after a change (a planned or recurring item, a budget); keeps the current answer on screen meanwhile. */
  reload: () => void;
  /** The viewer may edit at least one account in view: without it a tab shows no edit controls. */
  canEdit: boolean;
  /** Switch tab (the hash), keeping the month: the summary opens `budget`, Eenmalig's dashed button opens `kalender`. */
  /** Opens a tab, optionally on a month (YYYY-MM; the running month clears the `maand` parameter). */
  openTab: (tab: PlanningTabId, month?: string) => void;
}

export const HORIZONS: Horizon[] = [3, 6, 12, 24];

/** Whole months from `from` to `to` (both `YYYY-MM`), negative when `to` is earlier. */
export const monthOffset = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

/** `month` (`YYYY-MM`) moved by `n` months. */
export function addMonths(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
}

/** The smallest horizon (3, 6, 12 or 24) whose range holds a month `offset` months after the running one; 24 for anything beyond. */
export const horizonFor = (offset: number): Horizon => HORIZONS.find((h) => offset <= h) ?? 24;
