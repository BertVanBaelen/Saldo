// Small pieces both new Planning lists and their sheets share (plan 0.8-7): the account pill, the sheet head and a labelled field group.
import type { ReactNode } from 'react';
import { SheetX } from '../components/ui';
import type { Account } from '../lib/types';
import { Badge } from '../ui';
import './PlanningItems.css';

/** The account an item belongs to: green for a personal account, violet for a shared one. */
export function AccountPill({ account, className }: { account: Pick<Account, 'name' | 'kind'>; className?: string }) {
  return (
    <Badge tone={account.kind === 'shared' ? 'shared' : 'green'} className={className}>
      {account.name}
    </Badge>
  );
}

/** The title row of a sheet with its ×. `id` is what the sheet's `labelledBy` points at; `busy` closes at once, because the sheet refuses to close while a request runs. */
export function SheetHead({ id, title, onClose, busy }: { id: string; title: string; onClose: () => void; busy?: boolean }) {
  return (
    <div className="pi-head">
      <h2 className="pi-title" id={id}>
        {title}
      </h2>
      <SheetX className="pi-close" onClose={onClose} instant={busy} />
    </div>
  );
}

/** A label above a control that has no label of its own. A segmented switch carries the accessible name itself; `named` makes the group the name's holder instead (a fixed account chip). */
export function Group({ label, children, named }: { label: string; children: ReactNode; named?: boolean }) {
  return (
    <div className="pi-field" role={named ? 'group' : undefined} aria-label={named ? label : undefined}>
      <span className="pi-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}
