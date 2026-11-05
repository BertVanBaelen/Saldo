import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, NEW_MANUAL, renderAt, SPAAR, stubApi } from '../test/helpers';
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

  it('offers both ways in the empty state of a user without accounts ([])', async () => {
    stubApi({ accounts: [] });
    renderAt('/rekeningen');
    expect(await screen.findByText('Nog geen rekeningen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Handmatige rekening/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Handmatige rekening' })).toBeTruthy();
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
