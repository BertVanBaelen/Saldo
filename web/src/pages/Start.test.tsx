import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GEDEELD, renderAt, SPAAR, stubApi, ZICHT } from '../test/helpers';
import type { Account } from '../lib/types';

const hero = () => document.querySelector('.hero') as HTMLElement;
const tile = (name: string) => within(hero()).getByText(name).closest('.hero-tile') as HTMLElement;

describe('Start · Saldo nu', () => {
  it('shows the sum of several accounts as information only, with a verdict per account', async () => {
    const low: Account = { ...GEDEELD, balance: 50000, state: 'buffer' };
    stubApi({ accounts: [ZICHT, SPAAR, low] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');

    // The sum: labelled as information, savings left out, no state of its own.
    expect(within(hero()).getByText('€ 2.468,82')).toBeTruthy();
    expect(within(hero()).getByText('Samen, ter info · zonder spaarrekeningen')).toBeTruthy();
    const top = hero().querySelector('.hero-top') as HTMLElement;
    expect(top.querySelector('.chip')).toBeNull();
    for (const verdict of ['Boven buffer', 'In de buffer', 'Rood']) expect(within(top).queryByText(verdict)).toBeNull();

    // The chip counts per-account verdicts.
    expect(within(hero()).getByText('1 rekening vraagt aandacht')).toBeTruthy();

    // Every account against its own buffer.
    expect(within(tile('Zichtrekening')).getByText('€ 1.968,82')).toBeTruthy();
    expect(within(tile('Zichtrekening')).getByText('€ 1.069 boven buffer')).toBeTruthy();
    expect(within(tile('Gedeelde rekening')).getByText('€ 100 onder buffer')).toBeTruthy();
    expect(within(hero()).queryByText('Spaarrekening')).toBeNull();
  });

  it('never judges the sum: a red account stays red even when the total looks fine', async () => {
    const red: Account = { ...GEDEELD, balance: -5000, state: 'neg' };
    stubApi({ accounts: [ZICHT, red] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(within(hero()).getByText('€ 1.918,82')).toBeTruthy();
    expect(within(hero()).getByText('Samen, ter info')).toBeTruthy();
    expect(within(tile('Gedeelde rekening')).getByText('Rood')).toBeTruthy();
    expect(within(hero()).getByText('1 rekening vraagt aandacht')).toBeTruthy();
  });

  it('says all accounts are above their buffer when they are', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD] });
    renderAt('/');
    expect(await screen.findByText('Alle rekeningen boven buffer')).toBeTruthy();
  });

  it('shows one account against its own buffer with its state chip', async () => {
    stubApi({ accounts: [ZICHT, SPAAR, GEDEELD] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));

    expect(within(hero()).getByText('Saldo nu · Zichtrekening')).toBeTruthy();
    expect(within(hero()).getByText('Boven buffer')).toBeTruthy();
    expect(within(hero()).getByText('€ 1.968,82')).toBeTruthy();
    expect(within(hero()).getByText('Buffer € 900,00')).toBeTruthy();
    expect(within(hero()).getByText('€ 1.068,82 boven buffer')).toBeTruthy();
    expect(within(hero()).queryByText(/ter info/)).toBeNull();
    expect(hero().classList.contains('hero--shared')).toBe(false);
  });

  it('uses the shared hero and the buffer chip for one shared account in its buffer', async () => {
    stubApi({ accounts: [ZICHT, { ...GEDEELD, balance: 54000, state: 'buffer' }] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    expect(within(hero()).getByText('In de buffer')).toBeTruthy();
    expect(within(hero()).getByText('€ 60,00 onder buffer')).toBeTruthy();
    expect(hero().classList.contains('hero--shared')).toBe(true);
  });

  it('lists the accounts by Persoonlijk and Gedeeld with members and the manager', async () => {
    stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(screen.getByText('Alleen jij ziet deze rekeningen')).toBeTruthy();
    expect(screen.getByText('Argenta · vandaag 04:02', { selector: '.list .row-sub' })).toBeTruthy();
    expect(screen.getByText('Met Partner · jij bent beheerder')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Leden: jij en Partner' })).toBeTruthy();
    expect(screen.queryByText('Alleen lezen')).toBeNull();
  });

  it('marks a shared account the viewer may only read', async () => {
    const ro: Account = {
      ...GEDEELD,
      permission: 'read',
      role: 'member',
      members: [
        { name: 'Bert', initial: 'B', role: 'member', permission: 'read', me: true },
        { name: 'Partner', initial: 'P', role: 'manager', permission: 'edit', me: false },
      ],
    };
    stubApi({ accounts: [ZICHT, ro] });
    renderAt('/');
    expect(await screen.findByText('Alleen lezen')).toBeTruthy();
    expect(screen.getByText('Partner beheert deze rekening. Je ziet alles, maar wijzigt niets.')).toBeTruthy();
    expect(screen.getByText('Met Partner · Partner is beheerder')).toBeTruthy();
  });

  it('welcomes a user without accounts and hides the scope switch and sync button', async () => {
    stubApi({ accounts: [], alerts: [] });
    renderAt('/');
    expect(await screen.findByText('Welkom bij Saldo')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Welke rekeningen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nu synchroniseren' })).toBeNull();
  });

  it('shows an error with retry when the accounts cannot be loaded', async () => {
    const api = stubApi();
    api.accounts.mockRejectedValueOnce(Object.assign(new Error('x'), {}));
    renderAt('/');
    const retry = await screen.findByRole('button', { name: 'Opnieuw proberen' });
    fireEvent.click(retry);
    expect(await screen.findByText('Saldo nu · alle rekeningen')).toBeTruthy();
  });

  it('starts a sync and shows the server message when it is too soon', async () => {
    const api = stubApi();
    const { ApiError } = await import('../lib/api');
    api.sync.mockRejectedValueOnce(new ApiError(429, 'too_many_requests', 'Je hebt net gesynchroniseerd.'));
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    fireEvent.click(screen.getByRole('button', { name: 'Nu synchroniseren' }));
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Bezig met synchroniseren' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Je hebt net gesynchroniseerd.')).toBeTruthy(), { timeout: 3000 });
  });
});
