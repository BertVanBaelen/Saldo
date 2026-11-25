// Meldingen: how Saldo tells you things. The page composes cards: the channel card (push on this device, e-mail), the types per
// group with their push and e-mail chips, the look-ahead, the quiet hours, the note about e-mail that cannot be turned off, and the
// test button. The groups, types, sublines and defaults come from the server (GET /api/notifications); the push channel of THIS
// device comes from lib/push.ts (PushCard.tsx). Changes save on toggle, optimistically (MeldingenSettings.ts).
// Design: finance-mockup/js/screens/meldingen.js; spec: analysis/screens/meldingen.md.
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { delay, ErrorState, Skel, useTitle } from '../components/ui';
import type { Lookahead, NotificationType } from '../lib/types';
import { SegmentedControl, Switch } from '../ui';
import { Chip, LockedChip } from './MeldingenChip';
import { useNotificationSettings } from './MeldingenSettings';
import { pushIsOn, PushNotice, PushRow, PushTest, usePushDevice } from './PushCard';
import './Meldingen.css';

const LOOKAHEAD: { value: Lookahead; label: string }[] = [
  { value: 1, label: '1 maand' },
  { value: 3, label: '3 maanden' },
  { value: 6, label: '6 maanden' },
];

/** The state dot of a type: its token (`neg`, `warn`, ...) as a colour. Anything that is not a plain token name is not used. */
const dotColour = (dot: string) => (/^[a-z][a-zA-Z0-9-]*$/.test(dot) ? 'var(--' + dot + ')' : 'var(--muted)');

function Loading() {
  return (
    <div className="ml-state" role="status" aria-label="Meldingen laden">
      <section className="ml-card ml-channels">
        <div className="ml-setting">
          <Skel w="55%" h={15} />
        </div>
        <div className="ml-setting">
          <Skel w="40%" h={15} />
        </div>
      </section>
      <section className="ml-card">
        {[0, 1, 2].map((i) => (
          <div className="ml-type" key={i}>
            <Skel w={10} h={10} round />
            <span className="ml-type-text">
              <Skel w="60%" h={15} />
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

export function Meldingen() {
  useTitle('Meldingen');
  const { me, toast } = useApp();
  const push = usePushDevice();
  const { settings, change, ...notifications } = useNotificationSettings();

  const head = (
    <div className="ml-head anim-fade">
      <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
        <Icon name="back" size={22} stroke={2.4} />
      </Link>
      <div className="ml-head-title">
        <h1>Meldingen</h1>
        <span className="ml-head-sub only-desktop">Push en e-mail, per soort</span>
      </div>
    </div>
  );

  if (!push.snap || !settings) {
    const failed = push.error ?? notifications.error;
    return (
      <div className="page ml-page">
        {head}
        {failed ? (
          <div className="ml-state">
            <ErrorState
              message={failed}
              onRetry={() => {
                if (push.error) push.reload();
                if (notifications.error) notifications.reload();
              }}
            />
          </div>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const pushOn = pushIsOn(push);
  const emailOn = settings.channels.email;
  // The look-ahead belongs to the planning warnings: it sits in the group of the first planning type.
  const lookGroup = settings.types.find((t) => t.key === 'rood' || t.key === 'buffer')?.group ?? settings.groups[0]?.id;

  const row = (t: NotificationType) => (
    <div className="ml-type" key={t.key}>
      <span className="ml-dot" aria-hidden="true" style={{ background: dotColour(t.dot) }} />
      <span className="ml-type-text">
        <span className="ml-type-name">{t.name}</span>
        <span className="ml-type-sub">{t.subline}</span>
      </span>
      <Chip kind="push" label={t.name + ' als pushmelding'} on={t.push} disabled={!pushOn} onChange={(on) => change({ types: { [t.key]: { push: on } } })} />
      {t.emailLocked ? (
        <LockedChip name={t.name} onPress={() => toast('Deze e-mail kan je niet uitzetten')} />
      ) : (
        <Chip kind="email" label={t.name + ' per e-mail'} on={t.email} disabled={!emailOn} onChange={(on) => change({ types: { [t.key]: { email: on } } })} />
      )}
    </div>
  );

  const lookAhead = (
    <div className="ml-look">
      <span className="ml-look-title">Hoe ver vooruit kijken</span>
      <SegmentedControl
        aria-label="Hoe ver vooruit kijken"
        className="ml-seg"
        options={LOOKAHEAD.map((o) => ({ value: String(o.value), label: o.label }))}
        value={String(settings.lookahead)}
        onChange={(v) => change({ lookahead: Number(v) as Lookahead })}
      />
      <span className="ml-hint">Je krijgt één melding per maand en per rekening, op de ochtend nadat de planning verandert.</span>
    </div>
  );

  return (
    <div className="page ml-page">
      {head}
      <div className="ml-layout">
        <div className="ml-chan anim-in" style={delay(30)}>
          <section className="ml-card ml-channels" aria-label="Kanalen">
            <PushRow device={push} />
            <div className="ml-setting">
              <Switch className="ml-switch" isSelected={emailOn} onChange={(email) => change({ channels: { email } })} hint={me.user.email}>
                E-mail
              </Switch>
            </div>
          </section>
          <PushNotice device={push} />
        </div>

        <div className="ml-types">
          {settings.groups.map((g, i) => {
            const types = settings.types.filter((t) => t.group === g.id);
            if (!types.length) return null;
            return (
              <section className="ml-group anim-in" style={delay(60 + i * 30)} aria-labelledby={'ml-g-' + g.id} key={g.id}>
                <div className="ml-group-head">
                  <h2 className="label" id={'ml-g-' + g.id}>
                    {g.label}
                  </h2>
                  <span aria-hidden="true">Push · E-mail</span>
                </div>
                <div className="ml-card ml-list">
                  {types.map(row)}
                  {g.id === lookGroup && lookAhead}
                </div>
              </section>
            );
          })}
        </div>

        <section className="ml-card ml-quiet anim-in" style={delay(180)} aria-label="Stille uren">
          <div className="ml-setting">
            <Switch className="ml-switch" isSelected={settings.channels.quietHours} onChange={(quietHours) => change({ channels: { quietHours } })} hint="Geen pushmeldingen van 22:00 tot 07:00">
              Stille uren
            </Switch>
          </div>
        </section>

        <p className="ml-always anim-in" style={delay(200)}>
          <Icon name="lock" size={14} stroke={2.2} />
          <span>Inlogcodes, uitnodigingen en wachtwoordlinks komen altijd per e-mail. Die kan je niet uitzetten.</span>
        </p>

        <PushTest device={push} />
      </div>
    </div>
  );
}
