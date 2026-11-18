// Declare an account shared and invite people (0.8-0b): the "Delen" card of Rekening (the switch and "Mensen uitnodigen"),
// the select sheet "Wie nodig je uit?" and the invitee's dialog behind the `invite` alert (/rekeningen?uitnodiging=<id>).
// The server decides every rule (who may switch off, who may be invited); this only shows its answers.
// Spec: plan/v0.8-planning/00b-shared-flag-and-invitations.md.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet, useSheetClose } from '../components/Sheet';
import { delay, ErrorState, SheetX, SkelList } from '../components/ui';
import { isShared, others } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { names } from '../lib/format';
import type { Account, InvitableUser } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './RekeningUitnodigen.css';

const OFFLINE = (
  <p className="rk-offline">
    <Icon name="cloudOff" size={14} stroke={2.2} />
    Je bent offline. Dit kan weer zodra je verbinding hebt.
  </p>
);

// ---------- Invite sheet ----------

const TINTS = ['var(--c3)', 'var(--c1)', 'var(--c4)', 'var(--c5)'];

/** The other people on this Saldo: pick a free one and invite; an invited one can be taken back, a member just shows. */
function Picker({ a, onClose, onChanged }: { a: Account; onClose: () => void; onChanged: () => void }) {
  const { me, online, toast } = useApp();
  const close = useSheetClose();
  const people = useAsync((signal) => api.invitable(a.id, signal), [a.id]);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const users = people.data?.users;

  // Whatever went wrong (already invited, already a member), the list shows the truth again.
  const fail = (e: unknown) => {
    setBusy(false);
    setError(errorMessage(e));
    people.reload();
  };
  const invite = () => {
    const u = users?.find((x) => x.id === pick);
    if (!u || busy) return;
    setBusy(true);
    setError(null);
    api.inviteToAccount(a.id, u.id).then(() => {
      toast(u.name + ' is uitgenodigd');
      onChanged();
      close?.();
    }, fail);
  };
  const revoke = (u: InvitableUser) => {
    if (busy || u.invitationId === null) return;
    setBusy(true);
    setError(null);
    api.declineInvitation(u.invitationId).then(() => {
      toast('Uitnodiging voor ' + u.name + ' ingetrokken');
      setBusy(false);
      people.reload();
      onChanged();
      // The button that had the focus is gone: keep the focus in the sheet.
      requestAnimationFrame(() => listRef.current?.focus());
    }, fail);
  };

  const person = (u: InvitableUser, i: number) => (
    <>
      <span className="avatar avatar--md" style={{ background: TINTS[i % TINTS.length] }} aria-hidden="true">
        {u.initial}
      </span>
      <span className="ri-name">{u.name}</span>
    </>
  );

  return (
    <>
      <div className="rkd-dlg-head">
        <span className="rkd-dlg-icon ri-icon">
          <Icon name="userPlus" size={20} stroke={2.2} />
        </span>
        <h2 className="rkd-dlg-title" id="ri-title">
          Wie nodig je uit?
        </h2>
        <SheetX className="rk-close" onClose={onClose} />
      </div>
      {!users ? (
        people.error ? (
          <ErrorState title="Mensen laden lukt niet" message={people.error} onRetry={people.reload} />
        ) : (
          <SkelList rows={2} label="Mensen laden" />
        )
      ) : (
        users.length > 0 && (
          <ul className="ri-list" aria-label="Mensen" ref={listRef} tabIndex={-1}>
            {users.map((u, i) => (
              <li className="ri-row" key={u.id}>
                {u.state === 'free' ? (
                  <button type="button" className="ri-pick" aria-pressed={pick === u.id} onClick={() => setPick(pick === u.id ? null : u.id)}>
                    {person(u, i)}
                    <span className="ri-tick" aria-hidden="true">
                      {pick === u.id && <Icon name="check" size={16} stroke={3} />}
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="ri-pick ri-pick--static">
                      {person(u, i)}
                      <span className="ri-state">{u.state === 'member' ? 'lid' : 'uitgenodigd'}</span>
                    </span>
                    {u.state === 'invited' && (
                      <button type="button" className="ri-revoke" aria-label={'Intrekken voor ' + u.name} disabled={!online || busy} onClick={() => revoke(u)}>
                        Intrekken
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      {!online && OFFLINE}
      {users?.some((u) => u.state === 'free') && (
        <div className="rk-actions rk-actions--one">
          <button type="button" className="rk-btn rk-btn--primary" disabled={!online || busy || pick === null} aria-busy={busy || undefined} onClick={invite}>
            {busy ? 'Even geduld…' : 'Uitnodigen'}
          </button>
        </div>
      )}
      <p className="rk-help ri-note">
        Staat de persoon er niet bij? Een beheerder van Saldo nodigt nieuwe mensen uit in{' '}
        {me.user.role === 'admin' ? <Link to="/instellingen/gebruikers">Instellingen → Gebruikers</Link> : 'Instellingen → Gebruikers'}.
      </p>
    </>
  );
}

// ---------- The "Delen" card of Rekening (the account's manager only) ----------

interface CardProps {
  a: Account;
  /** The account as the server answers a change of the switch. */
  onAccount: (a: Account) => void;
  /** An invitation was made or taken back: load the accounts again (their `invitations` follow). */
  onInvitations: () => void;
}

/**
 * The switch "Dit is een gedeelde rekening" (it saves at once; switching on opens the invite sheet), or "Gedeeld met Partner"
 * once others joined (not editable), and "Mensen uitnodigen" while the account is shared.
 */
export function SharedCard({ a, onAccount, onInvitations }: CardProps) {
  const { online } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const on = isShared(a);
  const joined = a.members.length > 1;
  const open = a.invitations ?? [];

  // Rekeningen's "Delen instellen" opens the account page at /rekeningen/<id>#delen: scroll to this card and focus its first control.
  const card = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== '#delen') return;
    card.current?.scrollIntoView?.({ block: 'start' });
    card.current?.querySelector<HTMLElement>('[role="switch"], button')?.focus({ preventScroll: true });
    // Once, when the card appears (the account page renders it after the accounts are loaded).
  }, []);

  const toggle = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api.updateAccount(a.id, { shared: !on }).then(
      (x) => {
        setBusy(false);
        onAccount(x);
        // Switched on: the next step is to choose who comes along.
        if (isShared(x)) setInviting(true);
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <section className="card rkd-card anim-in" style={delay(100)} id="delen" aria-labelledby="rkd-h-share" ref={card}>
      <div className="rkd-card-head">
        <span className="rkd-card-titles">
          <h2 className="rkd-card-title" id="rkd-h-share">
            Delen
          </h2>
        </span>
      </div>
      <div className="ri-switch">
        <span className="ri-switch-text">
          <span className="rk-label" id="ri-share-l">
            {joined ? 'Gedeeld met ' + names(others(a).map((m) => m.name)) : 'Dit is een gedeelde rekening'}
          </span>
          <span className="rk-help" id="ri-share-h">
            {joined
              ? 'Zolang er meer dan één lid is, blijft de rekening gedeeld.'
              : 'Zet je deze rekening op gedeeld, dan telt ze mee onder Gedeeld en kan je anderen uitnodigen. Wie je uitnodigt, ziet haar saldo en geschiedenis, nooit je andere rekeningen.'}
          </span>
        </span>
        {!joined && (
          <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby="ri-share-l" aria-describedby="ri-share-h" disabled={!online} aria-disabled={busy || undefined} onClick={toggle} />
        )}
      </div>
      {on && open.length > 0 && (
        <p className="rkd-help">
          Uitgenodigd: {names(open.map((i) => i.name))}.{!joined && ' Trek eerst de uitnodiging in om dit uit te zetten.'}
        </p>
      )}
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      {on && (
        <div className="rkd-actions">
          <button type="button" className="btn btn--secondary btn--block" aria-haspopup="dialog" disabled={!online} onClick={() => setInviting(true)}>
            <Icon name="userPlus" size={18} stroke={2.2} />
            Mensen uitnodigen
          </button>
        </div>
      )}
      {!online && OFFLINE}
      {inviting && (
        <Sheet onClose={() => setInviting(false)} labelledBy="ri-title" className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
          <Picker a={a} onClose={() => setInviting(false)} onChanged={onInvitations} />
        </Sheet>
      )}
    </section>
  );
}

// ---------- The invitee's dialog ----------

/**
 * "<name> nodigt je uit voor <account>": all the invitee knows of the account is what the alert carries (`title`).
 * Toevoegen makes them a member at once; Niet nu declines. Closing (Escape, backdrop, ×) decides nothing: the alert stays.
 */
export function InviteeDialog({ id, title, onClose, onDone }: { id: number; title: string; onClose: () => void; onDone: () => void }) {
  const { online, toast, refreshShell } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = (task: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task.then(
      () => {
        // The alert is used up.
        refreshShell();
        onDone();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };
  const accept = () => go(api.acceptInvitation(id).then((x) => toast('Je bent nu lid van ' + x.name)));
  const decline = () => go(api.declineInvitation(id));

  return (
    <Sheet onClose={onClose} labelledBy="ri-inv-title" className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
      <div className="rkd-dlg-head">
        <span className="rkd-dlg-icon ri-icon">
          <Icon name="people" size={20} stroke={2.2} />
        </span>
        <h2 className="rkd-dlg-title" id="ri-inv-title">
          {title}
        </h2>
        <SheetX className="rk-close" onClose={onClose} />
      </div>
      <p className="rkd-dlg-text">
        Als je ze toevoegt, zie je haar saldo en geschiedenis, en zien de andere leden wat je op deze rekening doet. Je persoonlijke rekeningen blijven van jou.
      </p>
      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}
      {!online && OFFLINE}
      <div className="rk-actions">
        <button type="button" className="rk-btn rk-btn--ghost" disabled={busy} onClick={decline}>
          Niet nu
        </button>
        <button type="button" className="rk-btn rk-btn--primary" disabled={!online || busy} aria-busy={busy || undefined} onClick={accept}>
          {busy ? 'Even geduld…' : 'Toevoegen'}
        </button>
      </div>
    </Sheet>
  );
}
