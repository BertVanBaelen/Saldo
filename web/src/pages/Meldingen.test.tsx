import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_MESSAGE } from '../lib/api';
import { installPush, KEY, KEY_BYTES, type PushOptions } from '../test/push';
import { renderAt, stubApi } from '../test/helpers';
import { NOTIFICATIONS, stubNotifications } from '../test/notifications';
import type { NotificationSettings } from '../lib/types';

// The app heals push at its start (AppContext); this file looks at the card, so that run is left out here.
vi.mock('../lib/push', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/push')>()), syncPush: vi.fn(async () => undefined) }));

const toast = () => document.querySelector('.toast')?.textContent;
const IOS_INSTALL =
  'Zet Saldo op je beginscherm: tik op Deel, dan Zet op beginscherm. Open Saldo daarna vanaf je beginscherm en zet pushmeldingen aan. Je wordt eenmaal opnieuw ingelogd.';
const BLOCKED = 'Pushmeldingen zijn geblokkeerd voor Saldo in de instellingen van je telefoon of browser.';
const HTTPS = 'Pushmeldingen werken pas als Saldo op een https-adres draait.';
const PUSH_SWITCH = { name: /^Pushmeldingen/ };

/** The browser, the server's answers and the stubbed calls of one test. `settings` are the notification settings the server starts with. */
function setup(browser: PushOptions = {}, server: { enabled?: boolean; demo?: boolean; settings?: NotificationSettings } = {}) {
  stubApi();
  const notif = stubNotifications(server.settings ?? NOTIFICATIONS);
  const fake = installPush(browser);
  const pushKey = vi.spyOn(api, 'pushKey').mockResolvedValue({ key: KEY, enabled: server.enabled ?? true });
  vi.spyOn(api, 'health').mockResolvedValue({ status: 'ok', version: '0.9.0-dev', demo: server.demo ?? false });
  const save = vi.spyOn(api, 'savePushSubscription').mockResolvedValue(null);
  const del = vi.spyOn(api, 'deletePushSubscription').mockResolvedValue(null);
  const test = vi.spyOn(api, 'sendTestNotification').mockResolvedValue({ sent: true });
  return { fake, pushKey, save, del, test, notif };
}

const open = async () => {
  renderAt('/meldingen');
  await screen.findByRole('heading', { name: 'Meldingen' });
};
const pushSwitch = async () => (await screen.findByRole('switch', PUSH_SWITCH)) as HTMLInputElement;
const testButton = () => screen.queryByRole('button', { name: 'Stuur een testmelding' });

// ---------- The types, channels and look-ahead (0.9-4) ----------
const SUBSCRIBED: PushOptions = { permission: 'granted', subscribed: KEY_BYTES };
const TYPES = NOTIFICATIONS.types;
const NOT_LOCKED = TYPES.filter((t) => !t.emailLocked);
type Kind = 'push' | 'email';
const emailSwitch = async () => (await screen.findByRole('switch', { name: /^E-mail/ })) as HTMLInputElement;
/** The page with its settings loaded (the e-mail switch only shows when the push state and the settings are both in). */
const ready = async () => {
  await open();
  return emailSwitch();
};
const quietSwitch = () => screen.getByRole('switch', { name: /^Stille uren/ }) as HTMLInputElement;
const nameOf = (key: string) => TYPES.find((t) => t.key === key)!.name;
/** The chip of a type: a phone (push) or an envelope (e-mail). */
const chip = (key: string, kind: Kind) => screen.getByRole('button', { name: nameOf(key) + (kind === 'push' ? ' als pushmelding' : ' per e-mail') }) as HTMLButtonElement;
const lockedChip = () => screen.getByRole('button', { name: /^Nieuw toestel aangemeld per e-mail/ }) as HTMLButtonElement;
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const storedType = (settings: NotificationSettings, key: string) => settings.types.find((t) => t.key === key)!;

/** The next save of the notification settings waits for `release()`, then answers as the server would or, with `fail`, refuses. */
function hold(notif: ReturnType<typeof setup>['notif'], fail?: ApiError) {
  const real = notif.save.getMockImplementation()!;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  notif.save.mockImplementationOnce(async (patch) => {
    await gate;
    if (fail) throw fail;
    return real(patch);
  });
  return release;
}

// The page is a lazy chunk (React Aria): load it once up front, so the first test does not pay for it on a busy machine.
beforeAll(async () => {
  await import('./Meldingen');
}, 60_000);
beforeEach(() => localStorage.clear());
afterEach(() => Reflect.deleteProperty(window, 'isSecureContext'));

describe('Meldingen · page', () => {
  it('opens from Meer, has the title Meldingen and a way back to Meer', async () => {
    setup();
    renderAt('/meer');
    // The row of Meer (the sidebar link has no subline).
    fireEvent.click(await screen.findByRole('link', { name: /Push en e-mail, per soort/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meldingen' })).toBeTruthy();
    expect(document.title).toBe('Meldingen · Saldo');
    expect(screen.queryByText('Nog niet gebouwd')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/meldingen');

    const back = screen.getByRole('link', { name: 'Terug naar Meer' });
    expect(back.getAttribute('href')).toBe('/meer');
    fireEvent.click(back);
    expect(await screen.findByRole('heading', { level: 1, name: 'Meer' })).toBeTruthy();
  });
});

describe('Meldingen · Pushmeldingen card', () => {
  it('shows the channel with its subline and a switch that is off, and a test button', async () => {
    setup();
    await open();
    const sw = await pushSwitch();
    expect(sw.checked).toBe(false);
    expect(screen.getByText('Op dit toestel · Saldo op je startscherm')).toBeTruthy();
    expect(testButton()).toBeTruthy();
  });

  it('turns push on: asks the permission from the click, subscribes with the key of the server and tells the server', async () => {
    const { fake, save } = setup();
    await open();
    const sw = await pushSwitch();
    fireEvent.click(sw);

    await waitFor(() => expect(sw.checked).toBe(true));
    expect(fake.requestPermission).toHaveBeenCalledTimes(1);
    expect(fake.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: KEY_BYTES });
    expect(save).toHaveBeenCalledWith({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: { p256dh: 'p256dh-of-device-1', auth: 'auth-of-device-1' } });
    expect(toast()).toBeUndefined();
  });

  it('turns push off: the server forgets the device and the browser drops the subscription', async () => {
    const { fake, del } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    await open();
    const sw = await pushSwitch();
    expect(sw.checked).toBe(true);
    const sub = fake.current()!;
    fireEvent.click(sw);

    await waitFor(() => expect(sw.checked).toBe(false));
    expect(del).toHaveBeenCalledTimes(1);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.current()).toBeNull();
  });

  it('keeps the switch off and says so when the phone is told no: the blocked card appears', async () => {
    setup({ answer: 'denied' });
    await open();
    fireEvent.click(await pushSwitch());
    expect(await screen.findByText(BLOCKED)).toBeTruthy();
    expect(screen.getByRole('switch', PUSH_SWITCH).hasAttribute('disabled')).toBe(true);
    expect(testButton()).toBeNull();
  });

  it('stays off without a message when the question is dismissed', async () => {
    const { save, fake } = setup({ answer: 'default' });
    await open();
    const sw = await pushSwitch();
    fireEvent.click(sw);
    await waitFor(() => expect(fake.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sw.disabled).toBe(false));
    expect(sw.checked).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(toast()).toBeUndefined();
  });

  it('shows the message of the server when it refuses the subscription, and the switch stays off', async () => {
    const { save, fake } = setup();
    save.mockRejectedValue(new ApiError(400, 'invalid', 'Dit adres is geen pushdienst die Saldo kent.'));
    await open();
    const sw = await pushSwitch();
    fireEvent.click(sw);
    await waitFor(() => expect(toast()).toBe('Dit adres is geen pushdienst die Saldo kent.'));
    expect(sw.checked).toBe(false);
    expect(fake.current()).toBeNull();
  });

  it('cannot be switched again while a request runs', async () => {
    const { del } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    let finish: () => void = () => undefined;
    del.mockReturnValue(new Promise((resolve) => (finish = () => resolve(null))));
    await open();
    const sw = await pushSwitch();
    fireEvent.click(sw);
    await waitFor(() => expect(sw.disabled).toBe(true));
    finish();
    await waitFor(() => expect(sw.disabled).toBe(false));
  });

  it('loads again after a failed load', async () => {
    const { pushKey } = setup();
    pushKey.mockRejectedValueOnce(new ApiError(0, 'network', 'Saldo is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.'));
    await open();
    expect((await screen.findByRole('alert')).textContent).toContain('Saldo is niet bereikbaar');
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect((await pushSwitch()).checked).toBe(false);
  });
});

describe('Meldingen · test notification', () => {
  it('sends the test push and says it went to this device', async () => {
    const { test } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    await open();
    await pushSwitch();
    fireEvent.click(testButton()!);
    await waitFor(() => expect(toast()).toBe('Testmelding verstuurd naar dit toestel'));
    expect(test).toHaveBeenCalledTimes(1);
  });

  it('says push is off when the server has no subscription for this device (409)', async () => {
    const { test } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    test.mockRejectedValue(new ApiError(409, 'conflict', 'Pushmeldingen staan uit op dit toestel.'));
    await open();
    await pushSwitch();
    fireEvent.click(testButton()!);
    await waitFor(() => expect(toast()).toBe('Pushmeldingen staan uit'));
  });

  it('does not bother the server when the switch is off', async () => {
    const { test } = setup();
    await open();
    await pushSwitch();
    fireEvent.click(testButton()!);
    expect(toast()).toBe('Pushmeldingen staan uit');
    expect(test).not.toHaveBeenCalled();
  });

  it('shows the message of the server when the limit is reached', async () => {
    const { test } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    test.mockRejectedValue(new ApiError(429, 'rate_limited', 'Je hebt net een testmelding gestuurd. Probeer het straks opnieuw.', 600));
    await open();
    await pushSwitch();
    fireEvent.click(testButton()!);
    await waitFor(() => expect(toast()).toBe('Je hebt net een testmelding gestuurd. Probeer het straks opnieuw.'));
  });

  it('is disabled while the test runs', async () => {
    const { test } = setup({ permission: 'granted', subscribed: KEY_BYTES });
    let finish: () => void = () => undefined;
    test.mockReturnValue(new Promise((resolve) => (finish = () => resolve({ sent: true }))));
    await open();
    await pushSwitch();
    const button = testButton()!;
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    finish();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('adds the demo line under the button in demo mode only', async () => {
    setup({}, { demo: true });
    await open();
    await pushSwitch();
    expect(screen.getByText('Demo: er komt geen melding aan')).toBeTruthy();
  });

  it('has no demo line outside demo mode', async () => {
    setup();
    await open();
    await pushSwitch();
    expect(screen.queryByText(/Demo: er komt geen melding aan/)).toBeNull();
  });
});

describe('Meldingen · where push cannot be switched on', () => {
  it('asks an iPhone outside the installed app to put Saldo on the home screen: no switch, no test button', async () => {
    setup({ ios: true, noPushApis: true });
    await open();
    expect(await screen.findByText(IOS_INSTALL)).toBeTruthy();
    expect(screen.getByText('Pushmeldingen')).toBeTruthy();
    expect(screen.queryByRole('switch', PUSH_SWITCH)).toBeNull();
    expect(testButton()).toBeNull();
  });

  it('shows the switch again in the installed app of that iPhone', async () => {
    setup({ ios: true, standalone: true });
    await open();
    expect((await pushSwitch()).checked).toBe(false);
    expect(screen.queryByText(IOS_INSTALL)).toBeNull();
  });

  it('says where to allow notifications when the phone or browser blocks them: the switch is off and cannot be used', async () => {
    const { requestPermission } = setup({ permission: 'denied' }).fake;
    await open();
    expect(await screen.findByText(BLOCKED)).toBeTruthy();
    const sw = screen.getByRole('switch', PUSH_SWITCH) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    expect(testButton()).toBeNull();
    fireEvent.click(sw);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('says that push needs an https address when the server cannot do push, also on a phone that could', async () => {
    setup({ permission: 'granted', subscribed: KEY_BYTES }, { enabled: false });
    await open();
    expect(await screen.findByText(HTTPS)).toBeTruthy();
    expect(screen.queryByRole('switch', PUSH_SWITCH)).toBeNull();
    expect(testButton()).toBeNull();
  });

  it('says so when the browser has no push', async () => {
    setup({ noPushApis: true });
    await open();
    expect(await screen.findByText('Dit toestel of deze browser ondersteunt geen pushmeldingen.')).toBeTruthy();
    expect(screen.queryByRole('switch', PUSH_SWITCH)).toBeNull();
    expect(testButton()).toBeNull();
  });

  it('names the https address when the browser has no push because the page is not secure', async () => {
    setup({ noPushApis: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    await open();
    expect(await screen.findByText(HTTPS)).toBeTruthy();
  });
});

describe('Meldingen · keyboard and labels', () => {
  it('has native controls in a sensible order, each reachable with Tab, and every control has a name', async () => {
    setup({ permission: 'granted', subscribed: KEY_BYTES }, { demo: true });
    await open();
    const sw = await pushSwitch();
    const button = testButton()!;

    expect(sw.tagName).toBe('INPUT');
    expect(sw.type).toBe('checkbox');
    expect(button.tagName).toBe('BUTTON');
    expect(sw.tabIndex).toBeGreaterThanOrEqual(0);
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    expect(sw.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    sw.focus();
    expect(document.activeElement).toBe(sw);
    button.focus();
    expect(document.activeElement).toBe(button);

    for (const role of ['button', 'switch', 'link'] as const) {
      const all = screen.getAllByRole(role);
      expect(screen.getAllByRole(role, { name: /\S/ })).toHaveLength(all.length);
    }
  });

  it('keeps the same in the instruction states: no control without a name', async () => {
    setup({ permission: 'denied' });
    await open();
    await screen.findByText(BLOCKED);
    for (const role of ['button', 'switch', 'link'] as const) {
      const all = screen.queryAllByRole(role);
      expect(within(document.body).queryAllByRole(role, { name: /\S/ })).toHaveLength(all.length);
    }
  });
});

describe('Meldingen · groups and types from the server', () => {
  it('shows the groups in the order of the server, each with its types, sublines and state dots', async () => {
    setup(SUBSCRIBED);
    await ready();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(NOTIFICATIONS.groups.map((g) => g.label));
    for (const t of TYPES) {
      expect(screen.getByText(t.name)).toBeTruthy();
      expect(screen.getByText(t.subline)).toBeTruthy();
    }
    // Each group holds its own types.
    const bank = within(screen.getByRole('region', { name: 'Bank' }));
    expect(bank.getByText('Koppeling verloopt')).toBeTruthy();
    expect(bank.getByText('Synchronisatie gestopt')).toBeTruthy();
    expect(bank.queryByText('Rekening staat rood')).toBeNull();
    // The dot is the token of the type.
    const dotOf = (name: string) => screen.getByText(name).closest('.ml-type')!.querySelector('.ml-dot')!.getAttribute('style');
    expect(dotOf('Rekening staat rood')).toContain('var(--neg)');
    expect(dotOf('Koppeling verloopt')).toContain('var(--warn)');
    expect(dotOf('Iemand sluit aan')).toContain('var(--shared)');
    expect(dotOf('Te categoriseren')).toContain('var(--green)');
    expect(screen.getAllByText('Push · E-mail')).toHaveLength(NOTIFICATIONS.groups.length);
  });

  it("shows what the server stores in the chips: the defaults are the server's, not the screen's", async () => {
    setup(SUBSCRIBED);
    await ready();
    for (const t of NOT_LOCKED) {
      expect(pressed(chip(t.key, 'push'))).toBe(t.push);
      expect(pressed(chip(t.key, 'email'))).toBe(t.email);
    }
    expect(pressed(chip('device', 'push'))).toBe(true);
    // Weekoverzicht and Maandoverzicht are opt-in: both chips off.
    for (const key of ['week', 'month']) for (const kind of ['push', 'email'] as const) expect(pressed(chip(key, kind))).toBe(false);
  });

  it('draws whatever groups, types and choices the server sends', async () => {
    const custom: NotificationSettings = {
      channels: { email: false, quietHours: false },
      lookahead: 6,
      groups: [
        { id: 'extra', label: 'Extra' },
        { id: 'leeg', label: 'Leeg' },
      ],
      types: [{ key: 'nieuw', name: 'Een nieuwe soort', subline: 'Komt van de server', group: 'extra', dot: 'shared', push: false, email: true, emailLocked: false }],
    };
    setup(SUBSCRIBED, { settings: custom });
    await ready();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Extra']);
    expect(screen.getByText('Komt van de server')).toBeTruthy();
    expect(pressed(screen.getByRole('button', { name: 'Een nieuwe soort als pushmelding' }))).toBe(false);
    // The e-mail channel is off: the stored e-mail choice shows off.
    expect(pressed(screen.getByRole('button', { name: 'Een nieuwe soort per e-mail' }))).toBe(false);
    expect((await emailSwitch()).checked).toBe(false);
    expect(quietSwitch().checked).toBe(false);
    expect(screen.getByRole('radio', { name: '6 maanden' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Meldingen · chips', () => {
  it('saves every chip on its own: at once on screen, with only the field that changed', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const expected: unknown[] = [];
    for (const t of TYPES) {
      for (const kind of ['push', 'email'] as const) {
        if (kind === 'email' && t.emailLocked) continue;
        const el = chip(t.key, kind);
        expect(pressed(el)).toBe(t[kind]);
        fireEvent.click(el);
        expect(pressed(el)).toBe(!t[kind]);
        expected.push({ types: { [t.key]: { [kind]: !t[kind] } } });
        await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(expected.length));
      }
    }
    expect(notif.save.mock.calls.map((c) => c[0])).toEqual(expected);
    // The server's answers agree with what the screen shows, and no chip was refused.
    for (const t of TYPES) {
      expect(pressed(chip(t.key, 'push'))).toBe(!t.push);
      if (!t.emailLocked) expect(pressed(chip(t.key, 'email'))).toBe(!t.email);
    }
    expect(toast()).toBeUndefined();
  });

  it.each(['push', 'email'] as const)('rolls the %s chip back and shows the message of the server when the save fails', async (kind) => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const release = hold(notif, new ApiError(400, 'invalid', 'Dit kan niet.'));
    const el = chip('rood', kind);
    expect(pressed(el)).toBe(true);
    fireEvent.click(el);
    expect(pressed(el)).toBe(false); // optimistic: the answer is not in yet
    release();
    await waitFor(() => expect(toast()).toBe('Dit kan niet.'));
    expect(pressed(el)).toBe(true); // back
    expect(storedType(notif.server(), 'rood')[kind]).toBe(true);
    // And the chip works again.
    fireEvent.click(el);
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(storedType(notif.server(), 'rood')[kind]).toBe(false));
    expect(pressed(el)).toBe(false);
  });

  it('rolls an "off" chip that was turned on back to off, and says the server is not reachable', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    notif.save.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    const el = chip('buffer', 'email');
    expect(pressed(el)).toBe(false);
    fireEvent.click(el);
    await waitFor(() => expect(toast()).toBe(NETWORK_MESSAGE));
    expect(pressed(el)).toBe(false);
  });

  it('puts the two chips of a type in its own row, named for what they do', async () => {
    setup(SUBSCRIBED);
    await ready();
    const row = screen.getByText('Rekening staat rood').closest('.ml-type') as HTMLElement;
    const names = within(row)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Rekening staat rood als pushmelding', 'Rekening staat rood per e-mail']);
  });
});

describe('Meldingen · the e-mail that is always sent', () => {
  it('is on and fixed: reachable, named, a press explains it, and the server hears nothing', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const locked = lockedChip();
    expect(pressed(locked)).toBe(true);
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('aria-label')).toBe('Nieuw toestel aangemeld per e-mail: wordt altijd verstuurd, kan je niet uitzetten');
    locked.focus();
    expect(document.activeElement).toBe(locked);
    fireEvent.click(locked);
    expect(toast()).toBe('Deze e-mail kan je niet uitzetten');
    expect(pressed(locked)).toBe(true);
    expect(notif.save).not.toHaveBeenCalled();
    // The push chip of the same type is an ordinary one.
    fireEvent.click(chip('device', 'push'));
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ types: { device: { push: false } } }));
  });

  it('stays on, at full strength, when the e-mail channel is off', async () => {
    setup(SUBSCRIBED);
    await ready();
    fireEvent.click(await emailSwitch());
    await waitFor(() => expect(chip('rood', 'email').disabled).toBe(true));
    const locked = lockedChip();
    expect(pressed(locked)).toBe(true);
    expect(locked.disabled).toBe(false);
    expect(locked.classList.contains('ml-chip--locked')).toBe(true);
  });
});

describe('Meldingen · channels', () => {
  it('shows the e-mail channel with the address of the user and saves its switch', async () => {
    const { notif } = setup(SUBSCRIBED);
    const sw = await ready();
    expect(sw.checked).toBe(true);
    expect(screen.getByText('bert@jouw-domein.be')).toBeTruthy();
    fireEvent.click(sw);
    expect(sw.checked).toBe(false);
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ channels: { email: false } }));
    expect(notif.server().channels.email).toBe(false);
    expect(sw.checked).toBe(false);
  });

  it('with e-mail off, the e-mail chips are disabled and show off; the stored choices come back when it is on again, without a save', async () => {
    const { notif } = setup(SUBSCRIBED);
    const sw = await ready();
    fireEvent.click(sw);
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(1));
    for (const t of NOT_LOCKED) {
      const el = chip(t.key, 'email');
      expect(el.disabled).toBe(true);
      expect(pressed(el)).toBe(false);
      // Push is another channel: untouched.
      expect(chip(t.key, 'push').disabled).toBe(false);
      expect(pressed(chip(t.key, 'push'))).toBe(t.push);
    }
    // A press on a disabled chip does nothing.
    fireEvent.click(chip('rood', 'email'));
    expect(notif.save).toHaveBeenCalledTimes(1);

    fireEvent.click(sw);
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2));
    for (const t of NOT_LOCKED) {
      const el = chip(t.key, 'email');
      expect(el.disabled).toBe(false);
      expect(pressed(el)).toBe(t.email);
    }
    expect(notif.save.mock.calls.map((c) => c[0])).toEqual([{ channels: { email: false } }, { channels: { email: true } }]);
  });

  it('starts with e-mail off when the server says so: switch off, chips disabled, stored choices kept', async () => {
    const { notif } = setup(SUBSCRIBED, { settings: { ...NOTIFICATIONS, channels: { email: false, quietHours: true } } });
    const sw = await ready();
    expect(sw.checked).toBe(false);
    expect(chip('rood', 'email').disabled).toBe(true);
    expect(pressed(chip('rood', 'email'))).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(pressed(chip('rood', 'email'))).toBe(true)); // stored on
    expect(notif.save).toHaveBeenCalledWith({ channels: { email: true } });
  });

  it('rolls the e-mail switch and its chips back when the save fails', async () => {
    const { notif } = setup(SUBSCRIBED);
    const sw = await ready();
    const release = hold(notif, new ApiError(400, 'invalid', 'E-mail aanpassen lukt nu niet.'));
    fireEvent.click(sw);
    expect(sw.checked).toBe(false);
    expect(chip('rood', 'email').disabled).toBe(true);
    release();
    await waitFor(() => expect(toast()).toBe('E-mail aanpassen lukt nu niet.'));
    expect(sw.checked).toBe(true);
    expect(chip('rood', 'email').disabled).toBe(false);
    expect(pressed(chip('rood', 'email'))).toBe(true);
  });
});

describe('Meldingen · quiet hours', () => {
  it('shows the card with its explanation and saves the switch', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    expect(screen.getByText('Geen pushmeldingen van 22:00 tot 07:00')).toBeTruthy();
    const sw = quietSwitch();
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect(sw.checked).toBe(false);
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ channels: { quietHours: false } }));
    fireEvent.click(sw);
    await waitFor(() => expect(notif.save).toHaveBeenLastCalledWith({ channels: { quietHours: true } }));
    expect(notif.server().channels.quietHours).toBe(true);
  });

  it('is off when the server says so, and rolls back when a save fails', async () => {
    const { notif } = setup(SUBSCRIBED, { settings: { ...NOTIFICATIONS, channels: { email: true, quietHours: false } } });
    await ready();
    const sw = quietSwitch();
    expect(sw.checked).toBe(false);
    notif.save.mockRejectedValueOnce(new ApiError(500, 'server', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    fireEvent.click(sw);
    expect(sw.checked).toBe(true);
    await waitFor(() => expect(toast()).toBe('Er ging iets mis op de server (500). Probeer het opnieuw.'));
    expect(sw.checked).toBe(false);
  });
});

describe('Meldingen · look-ahead', () => {
  const radio = (name: string) => screen.getByRole('radio', { name });
  const checked = (name: string) => radio(name).getAttribute('aria-checked') === 'true';

  it('sits in the planning card with its note, shows the stored choice and saves another', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const planning = within(screen.getByRole('region', { name: 'Planning' }));
    expect(planning.getByText('Hoe ver vooruit kijken')).toBeTruthy();
    expect(planning.getByText('Je krijgt één melding per maand en per rekening, op de ochtend nadat de planning verandert.')).toBeTruthy();
    expect(planning.getByRole('radiogroup', { name: 'Hoe ver vooruit kijken' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['1 maand', '3 maanden', '6 maanden']);
    expect(checked('3 maanden')).toBe(true);

    fireEvent.click(radio('6 maanden'));
    expect(checked('6 maanden')).toBe(true);
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ lookahead: 6 }));
    expect(notif.server().lookahead).toBe(6);
    fireEvent.click(radio('1 maand'));
    await waitFor(() => expect(notif.save).toHaveBeenLastCalledWith({ lookahead: 1 }));
    expect(checked('1 maand')).toBe(true);
  });

  it('goes back to the earlier choice when the save fails', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const release = hold(notif, new ApiError(400, 'invalid', 'Kies 1, 3 of 6 maanden.'));
    fireEvent.click(radio('6 maanden'));
    expect(checked('6 maanden')).toBe(true);
    expect(checked('3 maanden')).toBe(false);
    release();
    await waitFor(() => expect(toast()).toBe('Kies 1, 3 of 6 maanden.'));
    expect(checked('3 maanden')).toBe(true);
    expect(checked('6 maanden')).toBe(false);
  });
});

describe('Meldingen · push chips follow this device', () => {
  it('disables the push chips and shows them off while this device has no subscription; the stored choices come back with the switch, without a save', async () => {
    const { notif } = setup();
    await ready();
    for (const t of TYPES) {
      const el = chip(t.key, 'push');
      expect(el.disabled).toBe(true);
      expect(pressed(el)).toBe(false);
    }
    // E-mail is not about this device.
    expect(chip('rood', 'email').disabled).toBe(false);
    fireEvent.click(chip('rood', 'push'));
    expect(notif.save).not.toHaveBeenCalled();

    fireEvent.click(await pushSwitch());
    await waitFor(() => expect(chip('rood', 'push').disabled).toBe(false));
    for (const t of TYPES) expect(pressed(chip(t.key, 'push'))).toBe(t.push);
    expect(notif.save).not.toHaveBeenCalled();

    // And off again: the choices stay on the server, the chips go quiet.
    fireEvent.click(await pushSwitch());
    await waitFor(() => expect(chip('rood', 'push').disabled).toBe(true));
    expect(pressed(chip('rood', 'push'))).toBe(false);
    expect(notif.save).not.toHaveBeenCalled();
  });

  it('enables them when the device has a subscription', async () => {
    setup(SUBSCRIBED);
    await ready();
    for (const t of TYPES) expect(chip(t.key, 'push').disabled).toBe(false);
  });

  it.each([
    ['the phone blocks notifications', { permission: 'denied' } as PushOptions, {}],
    ['an iPhone is outside the installed app', { ios: true, noPushApis: true } as PushOptions, {}],
    ['the browser has no push', { noPushApis: true } as PushOptions, {}],
    ['the server cannot do push (no https address)', SUBSCRIBED, { enabled: false }],
  ])('keeps them disabled and off when %s', async (_why, browser, server) => {
    setup(browser, server);
    await ready();
    for (const t of TYPES) {
      expect(chip(t.key, 'push').disabled).toBe(true);
      expect(pressed(chip(t.key, 'push'))).toBe(false);
    }
    expect(chip('rood', 'email').disabled).toBe(false);
    expect(pressed(chip('rood', 'email'))).toBe(true);
  });
});

describe('Meldingen · saves in order', () => {
  it('a second tap while the first save runs waits for it, builds on it, and the screen shows the last choice', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const release = hold(notif);
    const el = chip('rood', 'push');
    fireEvent.click(el); // on -> off
    fireEvent.click(el); // off -> on, at once, before the first answer
    expect(pressed(el)).toBe(true);
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(notif.save).toHaveBeenCalledTimes(1); // the second does not start before the first has been answered
    expect(notif.save).toHaveBeenLastCalledWith({ types: { rood: { push: false } } });
    release();
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2));
    expect(notif.save).toHaveBeenLastCalledWith({ types: { rood: { push: true } } });
    await waitFor(() => expect(storedType(notif.server(), 'rood').push).toBe(true));
    expect(pressed(el)).toBe(true);
  });

  it('the answer to an earlier save does not undo a newer tap', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const releaseA = hold(notif);
    const releaseB = hold(notif);
    fireEvent.click(chip('rood', 'email')); // A: on -> off
    fireEvent.click(quietSwitch()); // B: on -> off
    releaseA();
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2)); // A answered, B started
    // A's answer says quiet hours are still on (B is not stored yet); the screen keeps B's choice.
    expect(pressed(chip('rood', 'email'))).toBe(false);
    expect(quietSwitch().checked).toBe(false);
    releaseB();
    await waitFor(() => expect(notif.server().channels.quietHours).toBe(false));
    expect(quietSwitch().checked).toBe(false);
    expect(pressed(chip('rood', 'email'))).toBe(false);
  });

  it('when the first save fails and the second works, only the first is rolled back', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const release = hold(notif, new ApiError(400, 'invalid', 'Dit kan niet.'));
    fireEvent.click(chip('rood', 'email')); // refused
    fireEvent.click(chip('buffer', 'email')); // works
    expect(pressed(chip('rood', 'email'))).toBe(false);
    expect(pressed(chip('buffer', 'email'))).toBe(true);
    release();
    await waitFor(() => expect(toast()).toBe('Dit kan niet.'));
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(storedType(notif.server(), 'buffer').email).toBe(true));
    expect(pressed(chip('rood', 'email'))).toBe(true); // back
    expect(pressed(chip('buffer', 'email'))).toBe(true); // kept
    expect(storedType(notif.server(), 'rood').email).toBe(true);
  });
});

describe('Meldingen · loading, error and retry', () => {
  it('shows a loading state while the settings come in, and no control that cannot work yet', async () => {
    const { notif } = setup(SUBSCRIBED);
    let answer: (s: NotificationSettings) => void = () => undefined;
    notif.get.mockImplementationOnce(() => new Promise<NotificationSettings>((resolve) => (answer = resolve)));
    renderAt('/meldingen');
    expect(await screen.findByRole('status', { name: 'Meldingen laden' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Meldingen' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    answer(structuredClone(NOTIFICATIONS));
    await emailSwitch();
    expect(screen.queryByRole('status', { name: 'Meldingen laden' })).toBeNull();
  });

  it('says so when the settings do not load, and loads them again on request', async () => {
    const { notif } = setup(SUBSCRIBED);
    notif.get.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    await open();
    expect((await screen.findByRole('alert')).textContent).toContain(NETWORK_MESSAGE);
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await emailSwitch();
    expect(pressed(chip('rood', 'push'))).toBe(true);
    expect(notif.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows one error with one retry when both loads fail, and retries both', async () => {
    const { notif, pushKey } = setup(SUBSCRIBED);
    notif.get.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    pushKey.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    await open();
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await emailSwitch();
    expect(notif.get).toHaveBeenCalledTimes(2);
    expect(pushKey).toHaveBeenCalledTimes(2);
  });

  it('does not save anything by itself', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    expect(notif.save).not.toHaveBeenCalled();
  });
});

describe('Meldingen · layout, keyboard and names', () => {
  it('keeps the order channels, types, quiet hours, the note, the test button', async () => {
    setup(SUBSCRIBED);
    await ready();
    const order = [
      await pushSwitch(),
      await emailSwitch(),
      chip('rood', 'push'),
      screen.getByRole('radio', { name: '1 maand' }),
      chip('device', 'push'),
      quietSwitch(),
      screen.getByText('Inlogcodes, uitnodigingen en wachtwoordlinks komen altijd per e-mail. Die kan je niet uitzetten.'),
      testButton()!,
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Push en e-mail, per soort')).toBeTruthy();
  });

  it('operates with the keyboard: a chip is a button in the tab order, Space and Enter toggle it', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const el = chip('rood', 'push');
    expect(el.tagName).toBe('BUTTON');
    expect(el.tabIndex).toBeGreaterThanOrEqual(0);
    el.focus();
    expect(document.activeElement).toBe(el);

    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyUp(el, { key: ' ' });
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ types: { rood: { push: false } } }));
    expect(pressed(el)).toBe(false);

    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyUp(el, { key: 'Enter' });
    await waitFor(() => expect(notif.save).toHaveBeenCalledTimes(2));
    expect(notif.save).toHaveBeenLastCalledWith({ types: { rood: { push: true } } });
  });

  it('cannot reach a disabled chip: it is a disabled button, so it takes no focus and no key', async () => {
    const { notif } = setup(); // no subscription: the push chips are disabled
    await ready();
    const el = chip('rood', 'push');
    expect(el.disabled).toBe(true);
    el.focus();
    expect(document.activeElement).not.toBe(el);
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyUp(el, { key: ' ' });
    expect(notif.save).not.toHaveBeenCalled();
  });

  it('moves through the look-ahead with the arrow keys and picks with Space; the switches are native checkboxes in the tab order', async () => {
    const { notif } = setup(SUBSCRIBED);
    await ready();
    const three = screen.getByRole('radio', { name: '3 maanden' });
    three.focus();
    fireEvent.keyDown(three, { key: 'ArrowRight' });
    const six = screen.getByRole('radio', { name: '6 maanden' });
    expect(document.activeElement).toBe(six);
    expect(notif.save).not.toHaveBeenCalled(); // moving is not choosing
    fireEvent.keyDown(six, { key: ' ' });
    fireEvent.keyUp(six, { key: ' ' });
    await waitFor(() => expect(notif.save).toHaveBeenCalledWith({ lookahead: 6 }));
    for (const sw of [quietSwitch(), await emailSwitch()]) {
      expect(sw.type).toBe('checkbox');
      expect(sw.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every control a name: all chips, switches, radios, buttons and links', async () => {
    setup(SUBSCRIBED);
    await ready();
    for (const role of ['button', 'switch', 'radio', 'link'] as const) {
      const all = screen.getAllByRole(role);
      expect(screen.getAllByRole(role, { name: /\S/ })).toHaveLength(all.length);
    }
    // Two chips per type, each saying what it does and for which type.
    const chips = screen.getAllByRole('button', { name: / (als pushmelding|per e-mail)/ });
    expect(chips).toHaveLength(TYPES.length * 2);
    for (const t of TYPES) expect(chips.some((c) => c.getAttribute('aria-label')?.startsWith(t.name + ' als pushmelding'))).toBe(true);
  });
});
