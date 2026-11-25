// The two chips of a notification type on Meldingen: a phone (push) and an envelope (e-mail). Spec: analysis/screens/meldingen.md.
// Built on React Aria's ToggleButton (docs/third-party-ui.md), which brings `aria-pressed`, Space/Enter and the disabled state;
// the look is the mockup's chip on Saldo's tokens (Meldingen.css, `.ml-chip`).
import { ToggleButton } from 'react-aria-components';
import { Icon } from '../components/Icon';

interface ChipProps {
  kind: 'push' | 'email';
  /** The accessible name: "<type> als pushmelding" or "<type> per e-mail". */
  label: string;
  /** The stored choice. A disabled chip shows off whatever is stored; the choice comes back when the chip is enabled again. */
  on: boolean;
  /** Its channel is off (e-mail), or this device has no push subscription (push). */
  disabled: boolean;
  onChange: (next: boolean) => void;
}

export function Chip({ kind, label, on, disabled, onChange }: ChipProps) {
  return (
    <ToggleButton className="ml-chip" aria-label={label} isSelected={on && !disabled} isDisabled={disabled} onChange={onChange}>
      <Icon name={kind === 'push' ? 'phone' : 'mail'} size={18} stroke={2.2} />
    </ToggleButton>
  );
}

/**
 * The e-mail that is always sent (a new device signed in): on and fixed, also when the e-mail channel is off. It is
 * `aria-disabled`, not `disabled`, so it stays reachable with the keyboard, its name tells why, and a press explains it (the mockup's choice).
 */
export function LockedChip({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <button type="button" className="ml-chip ml-chip--locked" aria-pressed="true" aria-disabled="true" aria-label={name + ' per e-mail: wordt altijd verstuurd, kan je niet uitzetten'} onClick={onPress}>
      <Icon name="lock" size={16} stroke={2.2} />
    </button>
  );
}
