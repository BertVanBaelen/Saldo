import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import type { Account } from '../lib/types';
import { asMember, GEDEELD, INVITABLE, INVITE_ALERT, ME, renderAt, stubApi, ZICHT } from '../test/helpers';

const toast = () => document.querySelector('.toast')?.textContent;
const SWITCH = { name: 'Dit is een gedeelde rekening' };
const delen = () => screen.getByRole('heading', { name: 'Delen' }).closest('section') as HTMLElement;
/** A one-member account its manager declared shared, with an open invitation for Partner. */
const FLAGGED: Account = {
  ...ZICHT,
  kind: 'shared',
  members: [GEDEELD.members[0]],
  invitations: [{ id: 7, userId: 2, name: 'Partner', createdAt: '2026-11-18T20:00:00+01:00' }],
};

describe('Delen · the switch "Dit is een gedeelde rekening"', () => {
  it.each([
    ['the manager of a personal account', ZICHT, 'switch'],
    ['the manager once Partner joined', GEDEELD, 'Gedeeld met Partner'],
    ['a member who may edit', asMember('edit'), null],
    ['a read-only member', asMember('read'), null],
  ])('%s sees %s', async (_who, account, shows) => {
    stubApi({ accounts: [account] });
    renderAt('/rekeningen/' + account.id);
    await screen.findByRole('heading', { level: 1, name: account.name });
    // The switch for the manager alone; once others joined it is text (not editable); a member sees the state in the head, never a switch.
    expect(!!screen.queryByRole('switch', SWITCH)).toBe(shows === 'switch');
    expect(!!screen.queryByText('Gedeeld met Partner')).toBe(shows === 'Gedeeld met Partner');
    expect(!!screen.queryByRole('heading', { name: 'Delen' })).toBe(shows !== null);
  });

  it('saves at once and opens the invite sheet on switching on', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/rekeningen/1');
    const sw = await screen.findByRole('switch', SWITCH);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(api.updateAccount).toHaveBeenCalledWith(1, { shared: true });
    expect(await screen.findByRole('dialog', { name: 'Wie nodig je uit?' })).toBeTruthy();
    expect(screen.getByRole('switch', SWITCH).getAttribute('aria-checked')).toBe('true');
    expect(within(delen()).getByRole('button', { name: /Mensen uitnodigen/ })).toBeTruthy();
  });

  it('explains an open invitation and shows the server’s refusal to switch off', async () => {
    const api = stubApi({ accounts: [FLAGGED] });
    api.updateAccount.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Trek eerst de uitnodiging in.'));
    renderAt('/rekeningen/1');
    const sw = await screen.findByRole('switch', SWITCH);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(within(delen()).getByText(/Uitgenodigd: Partner\. Trek eerst de uitnodiging in/)).toBeTruthy();
    fireEvent.click(sw);
    expect((await within(delen()).findByRole('alert')).textContent).toBe('Trek eerst de uitnodiging in.');
    expect(api.updateAccount).toHaveBeenCalledWith(1, { shared: false });
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('lists the open invitations under the account on Rekeningen, and a flagged account reads Gedeeld', async () => {
    stubApi({ accounts: [FLAGGED] });
    renderAt('/rekeningen');
    expect((await screen.findAllByText('Uitgenodigd: Partner')).length).toBeGreaterThan(0);
    expect(screen.getByText('· nog met niemand')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gedeeld' })).toBeTruthy();
  });
});

describe('Delen · the invite sheet', () => {
  const open = async (me = ME) => {
    renderAt('/rekeningen/1', me);
    fireEvent.click(await screen.findByRole('button', { name: /Mensen uitnodigen/ }));
    return screen.findByRole('dialog', { name: 'Wie nodig je uit?' });
  };

  it('shows the people with their state, invites the one picked and takes an invitation back', async () => {
    const api = stubApi({ accounts: [FLAGGED] });
    const sheet = await open();
    expect(api.invitable).toHaveBeenCalledWith(1, expect.anything());
    // A member shows as "lid", an invited person as "uitgenodigd" with Intrekken; only a free person can be picked.
    expect(within(sheet).getByText('lid')).toBeTruthy();
    expect(within(sheet).getByText('uitgenodigd')).toBeTruthy();
    const go = within(sheet).getByRole('button', { name: 'Uitnodigen' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Intrekken voor Partner' }));
    await waitFor(() => expect(api.declineInvitation).toHaveBeenCalledWith(7));
    await waitFor(() => expect(toast()).toBe('Uitnodiging voor Partner ingetrokken'));
    expect(screen.getByRole('dialog', { name: 'Wie nodig je uit?' })).toBeTruthy();

    const derde = within(sheet).getByRole('button', { name: 'Derde' });
    fireEvent.click(derde);
    expect(derde.getAttribute('aria-pressed')).toBe('true');
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(api.inviteToAccount).toHaveBeenCalledWith(1, 3));
    await waitFor(() => expect(toast()).toBe('Derde is uitgenodigd'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The accounts load again, so the invitations follow.
    expect(api.accounts).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an admin gets a link to Gebruikers', ME, INVITABLE],
    ['someone else gets the plain sentence', { ...ME, user: { ...ME.user, role: 'user' as const } }, INVITABLE],
    ['an empty list shows only the note', ME, []],
  ])('%s', async (_who, me, users) => {
    stubApi({ accounts: [FLAGGED], invitable: users });
    const sheet = await open(me);
    expect(within(sheet).getByText(/Staat de persoon er niet bij\?/)).toBeTruthy();
    const link = within(sheet).queryByRole('link', { name: 'Instellingen → Gebruikers' });
    expect(link?.getAttribute('href')).toBe(me.user.role === 'admin' ? '/instellingen/gebruikers' : undefined);
    expect(!!within(sheet).queryByRole('list')).toBe(users.length > 0);
    expect(!!within(sheet).queryByRole('button', { name: 'Uitnodigen' })).toBe(users.length > 0);
  });
});

describe('Delen · the invitation of the invitee', () => {
  it.each([
    ['Toevoegen', 'acceptInvitation', 'Je bent nu lid van Vakantiepot'],
    ['Niet nu', 'declineInvitation', undefined],
  ] as const)('%s answers it, closes the dialog and loads the accounts again', async (button, call, said) => {
    const api = stubApi({ alerts: [INVITE_ALERT] });
    renderAt('/rekeningen?uitnodiging=7');
    // Only what the alert carries: the inviter, the account's name, and what joining means.
    const dialog = await screen.findByRole('dialog', { name: 'Bert nodigt je uit voor Vakantiepot' });
    expect(within(dialog).getByText(/zie je haar saldo en geschiedenis/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: button }));
    await waitFor(() => expect(api[call]).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location').textContent).toBe('/rekeningen');
    expect(api.accounts).toHaveBeenCalledTimes(2);
    expect(toast()).toBe(said);
  });

  it('drops a link to an invitation that is gone, with a toast', async () => {
    stubApi({ alerts: [INVITE_ALERT] });
    renderAt('/rekeningen?uitnodiging=99');
    await waitFor(() => expect(toast()).toBe('Deze uitnodiging bestaat niet meer.'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/rekeningen'));
  });
});
