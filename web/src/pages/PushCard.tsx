// The push channel of Meldingen, on this device: the state and actions (`usePushDevice`), the switch row, the instruction
// cards (iPhone, blocked, not available) and the test button. Spec: analysis/screens/meldingen.md; logic: src/lib/push.ts.
// Phase 0.9-4 split the old card into these pieces: Meldingen puts the switch row beside the e-mail row in one channel card,
// the instruction card under it, and the test button at the end of the page; the type chips read the state of this device.
import { useState, type ReactNode } from 'react';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { api, ApiError, errorMessage } from '../lib/api';
import { disablePush, enablePush, pushErrorMessage, pushState, type PushState } from '../lib/push';
import { useAsync } from '../lib/useAsync';
import { Switch } from '../ui';

export interface Snapshot {
  state: PushState;
  /** The server can do Web Push (an https address, or demo mode). */
  enabled: boolean;
  demo: boolean;
}

export const PUSH_HINT = 'Op dit toestel · Saldo op je startscherm';
const IOS_INSTALL =
  'Zet Saldo op je beginscherm: tik op Deel, dan Zet op beginscherm. Open Saldo daarna vanaf je beginscherm en zet pushmeldingen aan. Je wordt eenmaal opnieuw ingelogd.';
const BLOCKED = 'Pushmeldingen zijn geblokkeerd voor Saldo in de instellingen van je telefoon of browser.';
const NEEDS_HTTPS = 'Pushmeldingen werken pas als Saldo op een https-adres draait.';
const NOT_SUPPORTED = 'Dit toestel of deze browser ondersteunt geen pushmeldingen.';

function Notice({ icon, tone, children }: { icon: IconName; tone?: 'warn'; children: ReactNode }) {
  return (
    <div className={'ml-notice' + (tone ? ' ml-notice--' + tone : '')}>
      <Icon name={icon} size={16} stroke={2.2} />
      <p>{children}</p>
    </div>
  );
}

/** The card that replaces the switch when this device cannot (yet) turn push on; null when the switch works. */
function notice(s: Snapshot): ReactNode {
  if (!s.enabled) return <Notice icon="info">{NEEDS_HTTPS}</Notice>;
  switch (s.state) {
    case 'ios-install':
      return <Notice icon="phone">{IOS_INSTALL}</Notice>;
    case 'unsupported':
      // Without https the browser offers no service worker either: that is the likelier reason.
      return <Notice icon="info">{window.isSecureContext === false ? NEEDS_HTTPS : NOT_SUPPORTED}</Notice>;
    case 'blocked':
      return (
        <Notice icon="lock" tone="warn">
          {BLOCKED}
        </Notice>
      );
    default:
      return null;
  }
}

export interface PushDevice {
  /** What this device can do; `undefined` while it loads or when the load failed (`error`). */
  snap: Snapshot | undefined;
  error: string | null;
  reload: () => void;
  /** The switch shows where push can work, and stays off and disabled while the device is blocked; an instruction card replaces it elsewhere. */
  showSwitch: boolean;
  usable: boolean;
  busy: boolean;
  testing: boolean;
  toggle: (next: boolean) => void;
  sendTest: () => void;
}

/** True when this device has a push subscription and the server can send to it: the push chips of the types work only then. */
export function pushIsOn(device: PushDevice): boolean {
  return device.snap?.state === 'on' && device.snap.enabled;
}

export function usePushDevice(): PushDevice {
  const { toast } = useApp();
  const snapshot = useAsync<Snapshot>(async (signal) => {
    const [state, config, health] = await Promise.all([pushState(), api.pushKey(signal), api.health(signal).catch(() => null)]);
    return { state, enabled: config.enabled, demo: health?.demo ?? false };
  }, []);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const snap = snapshot.data;
  const showSwitch = !!snap && snap.enabled && (snap.state === 'on' || snap.state === 'off' || snap.state === 'blocked');
  const usable = showSwitch && snap.state !== 'blocked';

  const toggle = (next: boolean) => {
    if (!snap || busy || !usable) return;
    setBusy(true);
    (next ? enablePush() : disablePush())
      .then(
        (state) => snapshot.setData({ ...snap, state }),
        (e) => toast(pushErrorMessage(e)),
      )
      .finally(() => setBusy(false));
  };

  const sendTest = () => {
    if (!snap) return;
    // A device without a subscription has nobody to send to: the server would answer 409, so do not ask.
    if (snap.state !== 'on') {
      toast('Pushmeldingen staan uit');
      return;
    }
    setTesting(true);
    api
      .sendTestNotification()
      .then(
        () => toast('Testmelding verstuurd naar dit toestel'),
        (e) => toast(e instanceof ApiError && e.status === 409 ? 'Pushmeldingen staan uit' : errorMessage(e)),
      )
      .finally(() => setTesting(false));
  };

  return { snap, error: snapshot.error, reload: snapshot.reload, showSwitch, usable, busy, testing, toggle, sendTest };
}

/** The row of the channel card: the switch, or the name alone where an instruction card replaces it. */
export function PushRow({ device }: { device: PushDevice }) {
  const { snap, showSwitch, usable, busy, toggle } = device;
  if (!snap) return null;
  return (
    <div className="ml-setting">
      {showSwitch ? (
        <Switch className="ml-switch" isSelected={snap.state === 'on'} isDisabled={busy || !usable} onChange={toggle} hint={PUSH_HINT}>
          Pushmeldingen
        </Switch>
      ) : (
        <span className="ml-setting-text">
          <span className="ml-setting-name">Pushmeldingen</span>
          <span className="ml-setting-sub">{PUSH_HINT}</span>
        </span>
      )}
    </div>
  );
}

/** The instruction card under the channel card (iPhone install, blocked, https, not supported); null when the switch works. */
export function PushNotice({ device }: { device: PushDevice }) {
  return device.snap ? <>{notice(device.snap)}</> : null;
}

/** "Stuur een testmelding" and, in demo mode, the line that no push will arrive; nothing where push cannot be used. */
export function PushTest({ device }: { device: PushDevice }) {
  const { snap, usable, testing, sendTest } = device;
  if (!snap || !usable) return null;
  return (
    <div className="ml-test-wrap">
      <button type="button" className="btn btn--dashed btn--block ml-test" disabled={testing} aria-busy={testing || undefined} onClick={sendTest}>
        Stuur een testmelding
      </button>
      {snap.demo && <p className="ml-demo">Demo: er komt geen melding aan</p>}
    </div>
  );
}
