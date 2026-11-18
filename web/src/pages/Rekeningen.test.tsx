import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, asMember, GEDEELD, NEW_MANUAL, renderAt, SPAAR, stubApi, ZICHT } from '../test/helpers';
import { patchOf, values } from './Rekeningen';
import { looksLikeIban } from './AddAccount';

describe('Rekeningen · add an account', () => {
  it('adds a manual savings account from "Rekening toevoegen"', async () => {
    const api = stubApi();
    renderAt('/rekeningen');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Rekening toevoegen' }))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /Bankrekening koppelen/ }).getAttribute('href')).toBe('/bankkoppelingen/koppelen');
    fireEvent.click(within(sheet).getByRole('button', { name: /Handmatige rekening/ }));

    const name = await within(sheet).findByLabelText('Naam');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toevoegen' }));
    expect(within(sheet).getByText('Geef de rekening een naam.')).toBeTruthy();

    fireEvent.change(name, { target: { value: 'Vakantiepot' } });
    fireEvent.change(within(sheet).getByLabelText(/IBAN/), { target: { value: 'geen iban' } });
    fireEvent.change(within(sheet).getByLabelText('Saldo vandaag'), { target: { value: '1.250,00' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toevoegen' }));
    expect(within(sheet).getByText('Dit lijkt geen geldig IBAN. Kijk het na of laat het leeg.')).toBeTruthy();
    expect(api.createAccount).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText(/IBAN/), { target: { value: 'BE83 3630 1234 5615' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toevoegen' }));
    // Green, orange and violet are taken: the new account gets the next free colour.
    await waitFor(() =>
      expect(api.createAccount).toHaveBeenCalledWith({ name: 'Vakantiepot', type: 'savings', colour: 'blue', buffer: 0, iban: 'BE83 3630 1234 5615', balance: 125000 }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Vakantiepot', { selector: '.rk-row-name' })).toBeTruthy();
    // With an IBAN, payments to it become transfers: the badge and the Start alert load again.
    expect(api.alerts).toHaveBeenCalledTimes(2);
  });

  it('adds a current account without a bank link, with its buffer', async () => {
    const api = stubApi();
    renderAt('/rekeningen');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Rekening toevoegen' }))[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Handmatige rekening/ }));
    fireEvent.change(await within(sheet).findByLabelText('Naam'), { target: { value: 'Contant' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: /Zichtrekening zonder bankkoppeling/ }));
    fireEvent.change(within(sheet).getByLabelText('Minimumbuffer'), { target: { value: '250' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toevoegen' }));
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({ name: 'Contant', type: 'current', buffer: 25000, balance: undefined })));
  });

  it('picks the colour with the arrow keys', async () => {
    const api = stubApi();
    renderAt('/rekeningen');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Rekening toevoegen' }))[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Handmatige rekening/ }));
    fireEvent.change(await within(sheet).findByLabelText('Naam'), { target: { value: 'Pot' } });
    // Blue is preselected (the next free colour); ArrowRight moves to Petrol, ArrowLeft twice to Violet.
    fireEvent.keyDown(within(sheet).getByRole('radio', { name: 'Blauw' }), { key: 'ArrowRight' });
    expect(within(sheet).getByRole('radio', { name: 'Petrol' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(within(sheet).getByRole('radio', { name: 'Petrol' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(within(sheet).getByRole('radio', { name: 'Violet' }));
    expect(within(sheet).getByRole('radio', { name: 'Violet' }).getAttribute('tabindex')).toBe('0');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toevoegen' }));
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pot', colour: 'violet' })));
  });

  it('offers both ways in the empty state of a user without accounts ([])', async () => {
    stubApi({ accounts: [] });
    renderAt('/rekeningen');
    expect(await screen.findByText('Nog geen rekeningen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Handmatige rekening/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Handmatige rekening' })).toBeTruthy();
  });

  it('refreshes the badge and alerts after setting an IBAN', async () => {
    const api = stubApi();
    renderAt('/rekeningen');
    fireEvent.click((await screen.findByText('Spaarrekening', { selector: '.rk-row-name' })).closest('button')!);
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText(/IBAN/), { target: { value: 'BE83 3630 1234 5615' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith(2, { iban: 'BE83 3630 1234 5615' }));
    await waitFor(() => expect(api.alerts).toHaveBeenCalledTimes(2));
  });

  it('links each account to its page', async () => {
    stubApi();
    renderAt('/rekeningen');
    fireEvent.click((await screen.findByText('Spaarrekening', { selector: '.rk-row-name' })).closest('button')!);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /Details en saldo bijwerken/ }).getAttribute('href')).toBe('/rekeningen/2');
  });

  it('shows a manual account without a balance as not updated yet', async () => {
    stubApi({ accounts: [...ACCOUNTS, NEW_MANUAL] });
    renderAt('/rekeningen');
    expect(await screen.findByText('Handmatig · bijgewerkt nog niet', { selector: '.rk-row-sub' })).toBeTruthy();
  });
});

describe('Rekeningen · the IBAN of a manual account', () => {
  it('sends a new IBAN, an empty string to remove it, and nothing when untouched', () => {
    expect(patchOf(SPAAR, values(SPAAR, {}))).toEqual({});
    expect(patchOf(SPAAR, values(SPAAR, { iban: 'BE83 3630 1234 5615' }))).toEqual({ iban: 'BE83 3630 1234 5615' });
    expect(patchOf(SPAAR, values(SPAAR, { iban: '  ' }))).toEqual({});
    expect(patchOf(SPAAR, values(SPAAR, { iban: null }))).toEqual({ iban: '' });
    expect(looksLikeIban('BE83 3630 1234 5615')).toBe(true);
    expect(looksLikeIban('BE00 1234')).toBe(false);
  });
});

describe('Rekeningen · settings of a shared account the viewer does not manage', () => {
  const open = async () => {
    fireEvent.click((await screen.findByText('Gedeelde rekening', { selector: '.rk-row-name' })).closest('button')!);
    return screen.findByRole('dialog');
  };

  it('opens read-only with the manager named, and only Sluiten, for a member who may edit', async () => {
    stubApi({ accounts: [ZICHT, asMember('edit')] });
    renderAt('/rekeningen');
    const sheet = await open();
    expect((within(sheet).getByLabelText('Naam') as HTMLInputElement).disabled).toBe(true);
    expect((within(sheet).getByLabelText('Minimumbuffer') as HTMLInputElement).disabled).toBe(true);
    expect(within(sheet).getByText('Partner (beheerder) past naam, kleur en buffer aan.')).toBeTruthy();
    expect(within(sheet).queryByText('Alleen lezen')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Opslaan' })).toBeNull();
    // The cross in the head and the button below; no save, no reset.
    expect(within(sheet).getAllByRole('button', { name: 'Sluiten' })).toHaveLength(2);
  });

  it('keeps the lock and the read-only note for a member who may only read', async () => {
    stubApi({ accounts: [ZICHT, asMember('read')] });
    renderAt('/rekeningen');
    const sheet = await open();
    expect(within(sheet).getByText('Alleen lezen')).toBeTruthy();
    expect(within(sheet).getByText('Partner (beheerder) gaf je leesrechten op deze rekening.')).toBeTruthy();
    expect((within(sheet).getByLabelText('Naam') as HTMLInputElement).disabled).toBe(true);
  });

  it('lets the manager change them', async () => {
    stubApi();
    renderAt('/rekeningen');
    const sheet = await open();
    expect((within(sheet).getByLabelText('Naam') as HTMLInputElement).disabled).toBe(false);
    expect(within(sheet).getByRole('button', { name: 'Opslaan' })).toBeTruthy();
  });
});

describe('Rekeningen · the row "Gedeelde rekening" in the editor', () => {
  const open = async (name: string) => {
    fireEvent.click((await screen.findByText(name, { selector: '.rk-row-name' })).closest('button')!);
    return screen.findByRole('dialog');
  };

  it.each([
    ['a personal current account', ZICHT, 'Persoonlijk', 'Delen instellen'],
    ['a shared one', GEDEELD, 'Gedeeld met Partner', 'Delen beheren'],
    ['a shared one nobody joined yet', { ...ZICHT, kind: 'shared' as const, members: [GEDEELD.members[0]] }, 'Gedeeld · nog met niemand', 'Delen beheren'],
    ['one the viewer does not manage', asMember('edit'), null, null],
    ['a savings account', SPAAR, null, null],
  ])('%s: the state and the button, or no row at all', async (_what, account, state, button) => {
    stubApi({ accounts: [account] });
    renderAt('/rekeningen');
    const sheet = await open(account.name);
    expect(!!within(sheet).queryByText('Gedeelde rekening', { selector: '.rk-label' })).toBe(state !== null);
    if (state) {
      expect(within(sheet).getByText(state)).toBeTruthy();
      expect(within(sheet).getByRole('button', { name: button! })).toBeTruthy();
    }
  });

  it('"Delen instellen" plays the sheet’s exit, then opens the account page at its Delen card', async () => {
    stubApi({ accounts: [ZICHT] });
    renderAt('/rekeningen');
    const sheet = await open('Zichtrekening');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delen instellen' }));
    // The page changes when the exit ends; the card's first control has the focus (the address carries #delen).
    const sw = await screen.findByRole('switch', { name: 'Dit is een gedeelde rekening' });
    expect(screen.getByTestId('location').textContent).toBe('/rekeningen/1');
    await waitFor(() => expect(document.activeElement).toBe(sw));
  });
});
