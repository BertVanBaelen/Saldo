// Password field with a show toggle, and the live hints for a new password. The server judges the password
// (length, blocklist, not the e-mail address); these hints only help while typing.
import { useState, type ComponentProps } from 'react';
import { Icon } from './Icon';

export const MIN_PASSWORD = 12;

export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input {...props} className={'input' + (className ? ' ' + className : '')} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" aria-label="Wachtwoord tonen" aria-pressed={show} aria-controls={props.id} onClick={() => setShow((s) => !s)}>
        <Icon name="eye" size={20} />
      </button>
    </div>
  );
}

type RuleState = '' | 'ok' | 'bad';

function Rule({ state, children }: { state: RuleState; children: string }) {
  return (
    <li className={state ? 'is-' + state : undefined}>
      <span className="pw-rule-dot" aria-hidden="true">
        {state === 'ok' && <Icon name="check" size={11} stroke={3.4} />}
        {state === 'bad' && <Icon name="close" size={10} stroke={3.4} />}
      </span>
      <span>
        {children}
        {state && <span className="visually-hidden">{state === 'ok' ? ' (in orde)' : ' (nog niet in orde)'}</span>}
      </span>
    </li>
  );
}

/** "Minstens 12 tekens" and "Twee keer hetzelfde", checked while typing. */
export function PasswordRules({ id, password, repeat }: { id: string; password: string; repeat: string }) {
  const long = password.length >= MIN_PASSWORD;
  const same: RuleState = !repeat ? '' : repeat === password ? 'ok' : repeat.length >= password.length ? 'bad' : '';
  return (
    <ul className="pw-rules" id={id}>
      <Rule state={long ? 'ok' : ''}>{'Minstens ' + MIN_PASSWORD + ' tekens' + (password && !long ? ' · nu ' + password.length : '')}</Rule>
      <Rule state={same}>Twee keer hetzelfde</Rule>
    </ul>
  );
}
