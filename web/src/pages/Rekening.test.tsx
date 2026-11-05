import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, CONNECTIONS, GEDEELD, NEW_MANUAL, renderAt, SPAAR, stubApi, UNLINKED, ZICHT } from '../test/helpers';
import type { Account } from '../lib/types';
import { removalSplit } from './Rekening';

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;

describe('Rekening · a bank account', () => {
  it('shows the balance against its own buffer, the history, recent transactions and the sync source', async () => {
    const api = stubApi();
    renderAt('/rekeningen/1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' })).toBeTruthy();
    expect(screen.getByText('€ 1.968,82')).toBeTruthy();
    expect(screen.getByText('€ 1.068,82 boven je buffer van € 900,00')).toBeTruthy();
    expect(screen.getByText('BE68 •••• •••• 4821')).toBeTruthy();

    const hist = card('Saldoverloop');
    expect(await within(hist).findByText('Onder de buffer')).toBeTruthy();
    expect(within(hist).getByText('1 dag')).toBeTruthy();

    const tx = card('Recente transacties');
    expect(await within(tx).findByText('Bol.com')).toBeTruthy();
    expect(within(tx).getByRole('link', { name: /Alle transacties/ }).getAttribute('href')).toBe('/transacties?rekening=1');
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ account: 1, limit: 5 }), expect.anything());

    const sync = card('Synchronisatie');
    expect(await within(sync).findByText('tot 30 november 2026 · nog 12 dagen')).toBeTruthy();
    expect(within(sync).getByRole('link', { name: /Opnieuw autoriseren/ }).getAttribute('href')).toBe('/bankkoppelingen/koppelen?koppeling=1');
    // A bank account's balance comes from the bank: no "Saldo bijwerken", no delete.
    expect(screen.queryByRole('heading', { name: 'Saldo bijwerken' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Rekening verwijderen' })).toBeNull();
  });

  it('removes the link and keeps the history', async () => {
    const api = stubApi();
    renderAt('/rekeningen/1');
    fireEvent.click(await screen.findByRole('button', { name: /Koppeling verwijderen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Geschiedenis bewaren/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByText(/Zichtrekening en alle transacties en saldi ervan worden gewist\. Gedeelde rekening blijft bestaan/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Koppeling verwijderen' }));
    await waitFor(() => expect(api.removeConnection).toHaveBeenCalledWith(1, 'keep'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location').textContent).toBe('/rekeningen/1');
  });

  it('asks a second, explicit step before it deletes history', async () => {
    const api = stubApi();
    renderAt('/rekeningen/1');
    fireEvent.click(await screen.findByRole('button', { name: /Koppeling verwijderen/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Geschiedenis verwijderen/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verder' }));
    expect(api.removeConnection).not.toHaveBeenCalled();

    expect(await within(dialog).findByRole('heading', { name: 'Zichtrekening definitief wissen?' })).toBeTruthy();
    const go = within(dialog).getByRole('button', { name: 'Definitief verwijderen' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Ik begrijp dat deze geschiedenis weg is' }));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(api.removeConnection).toHaveBeenCalledWith(1, 'delete'));
    // The account itself is gone: back to Rekeningen.
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/rekeningen'));
  });

  it('shows an account whose link was removed as not linked, with the way back', async () => {
    stubApi({ accounts: [UNLINKED, SPAAR], connections: [] });
    renderAt('/rekeningen/1');
    const sync = await screen.findByRole('heading', { name: 'Synchronisatie' });
    const box = sync.closest('section') as HTMLElement;
    expect(within(box).getByText('Niet meer gekoppeld')).toBeTruthy();
    expect(within(box).getByRole('link', { name: /Bank opnieuw koppelen/ }).getAttribute('href')).toBe('/bankkoppelingen/koppelen');
    expect(within(box).queryByRole('button', { name: /Koppeling verwijderen/ })).toBeNull();
    expect(screen.getByText('Argenta · niet meer gekoppeld · stand van 17 nov')).toBeTruthy();
  });

  it('is read-only for a member with read permission', async () => {
    const ro: Account = { ...GEDEELD, permission: 'read', role: 'member', members: [
      { name: 'Partner', initial: 'P', role: 'manager', permission: 'edit', me: false },
      { name: 'Bert', initial: 'B', role: 'member', permission: 'read', me: true },
    ] };
    stubApi({ accounts: [ZICHT, ro], connections: [] });
    renderAt('/rekeningen/4');
    await screen.findByRole('heading', { level: 1, name: 'Gedeelde rekening' });
    expect((screen.getByLabelText('Naam') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Opslaan' })).toBeNull();
    expect(screen.getByText('De koppeling van Partner houdt deze rekening bij. Je beheert alleen je eigen koppelingen.')).toBeTruthy();
  });

  it('says so when the account does not exist (or is not yours)', async () => {
    stubApi();
    renderAt('/rekeningen/99');
    expect(await screen.findByText('Deze rekening bestaat niet (meer)')).toBeTruthy();
  });
});

describe('Rekening · a manual account', () => {
  it('updates the balance by hand and lists the history', async () => {
    const api = stubApi();
    renderAt('/rekeningen/2');
    const upd = (await screen.findByRole('heading', { name: 'Saldo bijwerken' })).closest('section') as HTMLElement;
    expect(within(upd).getByText('Laatst bijgewerkt op 2 oktober 2026')).toBeTruthy();
    expect(await within(upd).findByText('+€ 200,00')).toBeTruthy();

    fireEvent.click(within(upd).getByRole('button', { name: 'Opslaan' }));
    expect(within(upd).getByText('Vul het saldo in, bijvoorbeeld 12.900,00.')).toBeTruthy();
    expect(api.setBalance).not.toHaveBeenCalled();

    fireEvent.change(within(upd).getByLabelText('Saldo'), { target: { value: '12.900,00' } });
    fireEvent.click(within(upd).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.setBalance).toHaveBeenCalledWith(2, 1290000, '2026-11-18'));
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(2));
  });

  it('starts empty for a manual account without a balance yet', async () => {
    stubApi({ accounts: [NEW_MANUAL] });
    renderAt('/rekeningen/7');
    expect(await screen.findByText('Nog geen saldo. Vul het saldo in bij Saldo bijwerken.')).toBeTruthy();
    expect(screen.getByText('Handmatig · nog geen saldo')).toBeTruthy();
    expect(screen.getByText('Geen IBAN')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Synchronisatie' })).toBeNull();
  });

  it('deletes a manual account after confirmation', async () => {
    const api = stubApi();
    renderAt('/rekeningen/2');
    const del = (await screen.findByRole('heading', { name: 'Rekening verwijderen' })).closest('section') as HTMLElement;
    fireEvent.click(within(del).getByRole('button', { name: /Rekening verwijderen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/saldogeschiedenis \(2 updates\)/)).toBeTruthy();
    expect(api.deleteAccount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rekening verwijderen' }));
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/rekeningen'));
  });
});

describe('Rekening · what a removal deletes', () => {
  it('deletes only the accounts nobody else sees', () => {
    expect(removalSplit(CONNECTIONS[0], ACCOUNTS)).toEqual({ gone: [ZICHT], kept: [GEDEELD] });
  });
});
