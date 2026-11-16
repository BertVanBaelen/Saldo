import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, asMember, CONNECTIONS, GEDEELD, NEW_MANUAL, renderAt, SPAAR, stubApi, UNLINKED, ZICHT } from '../test/helpers';
import { ApiError } from '../lib/api';
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

  it('counts calendar days under the buffer, not balance points, when the history has gaps', async () => {
    // Buffer € 900. One point per sync day, with gaps: under from 4 to 8 Nov (4 days), 12 to 14 Nov (2 days)
    // and from 16 Nov through today, 18 Nov (3 days). Three points are under the buffer, nine days.
    const balances = {
      1: [
        { date: '2026-11-01', balance: 200000, origin: 'bank' as const },
        { date: '2026-11-04', balance: 50000, origin: 'bank' as const },
        { date: '2026-11-08', balance: 200000, origin: 'bank' as const },
        { date: '2026-11-12', balance: 10000, origin: 'bank' as const },
        { date: '2026-11-14', balance: 150000, origin: 'bank' as const },
        { date: '2026-11-16', balance: 40000, origin: 'bank' as const },
      ],
    };
    stubApi({ balances });
    renderAt('/rekeningen/1');
    const hist = await screen.findByRole('heading', { name: 'Saldoverloop' }).then((h) => h.closest('section') as HTMLElement);
    await within(hist).findByText('Onder de buffer');
    expect(within(hist).getByText('9 dagen')).toBeTruthy();
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

  it('offers "Nu opnieuw proberen" when the sync failed, and not when it works', async () => {
    const api = stubApi({ accounts: [{ ...ZICHT, syncStatus: 'failed' }, SPAAR, GEDEELD] });
    const { unmount } = renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    const retry = await within(card('Synchronisatie')).findByRole('button', { name: 'Nu opnieuw proberen' });
    expect(retry.className).toBe('btn btn--primary btn--block');
    fireEvent.click(retry);
    await waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1));
    unmount();

    stubApi();
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    await within(card('Synchronisatie')).findByRole('button', { name: /Koppeling verwijderen/ });
    expect(within(card('Synchronisatie')).queryByRole('button', { name: 'Nu opnieuw proberen' })).toBeNull();
  });

  it('says why the sync of the account failed: its error code and last attempt', async () => {
    stubApi({ accounts: [{ ...ZICHT, syncStatus: 'failed', syncError: 'ASPSP_ERROR', lastAttempt: ZICHT.lastSync } as typeof ZICHT, SPAAR, GEDEELD] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(within(card('Synchronisatie')).getByText('Foutcode ASPSP_ERROR · laatste poging vandaag 04:02')).toBeTruthy();
  });

  it('shows what the last sync got from the bank and kept', async () => {
    const syncReport = { at: ZICHT.lastSync!, from: '2026-11-02', fetched: 12, added: 0, newest: '2026-11-18', balanceDate: '2026-11-18', idTail: 'a3f9' };
    stubApi({ accounts: [{ ...ZICHT, syncReport }, SPAAR, GEDEELD] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(within(card('Synchronisatie')).getByText('Laatste synchronisatie: de bank gaf 12 transacties vanaf 2 november, 0 nieuw (nieuwste 18 november), saldo van 18 november · bank-id …a3f9')).toBeTruthy();
  });

  it('shows no sync line before the first sync', async () => {
    stubApi({ accounts: [{ ...ZICHT, syncReport: null }, SPAAR, GEDEELD] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(within(card('Synchronisatie')).queryByText(/Laatste synchronisatie:/)).toBeNull();
  });

  it('says when the last consent left the account out', async () => {
    stubApi({ accounts: [{ ...ZICHT, syncStatus: 'failed', syncError: 'not_shared', lastAttempt: ZICHT.lastSync } as typeof ZICHT, SPAAR, GEDEELD] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(within(card('Synchronisatie')).getByText(/Niet gedeeld bij de laatste toestemming/)).toBeTruthy();
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
    stubApi({ accounts: [ZICHT, asMember('read')], connections: [] });
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
    // The sidebar badge and the Start alert load again: its transfers no longer count.
    expect(api.alerts).toHaveBeenCalledTimes(2);
    expect(api.transactions).toHaveBeenCalledWith({ uncategorised: true, limit: 1 });
  });

  it('refreshes the badge and alerts after a new IBAN, not after a rename', async () => {
    const api = stubApi();
    renderAt('/rekeningen/2');
    await screen.findByRole('heading', { level: 1, name: 'Spaarrekening' });
    const set = card('Instellen');
    fireEvent.change(within(set).getByLabelText('Naam'), { target: { value: 'Spaarpot' } });
    fireEvent.click(within(set).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledTimes(1));
    await screen.findByText('Spaarpot opgeslagen');
    expect(api.alerts).toHaveBeenCalledTimes(1);

    fireEvent.change(within(set).getByLabelText(/IBAN/), { target: { value: 'BE83 3630 1234 5615' } });
    fireEvent.click(within(set).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenLastCalledWith(2, { iban: 'BE83 3630 1234 5615' }));
    await waitFor(() => expect(api.alerts).toHaveBeenCalledTimes(2));
  });
});

describe('Rekening · what a removal deletes', () => {
  it('deletes only the accounts nobody else sees', () => {
    expect(removalSplit(CONNECTIONS[0], ACCOUNTS)).toEqual({ gone: [ZICHT], kept: [GEDEELD] });
  });
});

describe('Rekening · Je regels (the manager’s rules on a shared account)', () => {
  const shared = (convertibleRules: number, extra: Partial<Account> = {}): Account => ({ ...GEDEELD, convertibleRules, ...extra });
  const toast = () => document.querySelector('.toast')?.textContent;
  const BUTTON = 'Zet om naar regels van deze rekening';

  it('offers the manager to turn the rules that stopped applying into rules of the account, then the card is gone', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR, shared(3)] });
    renderAt('/rekeningen/4');
    const box = await screen.findByRole('heading', { name: 'Je regels' }).then((h) => h.closest('section') as HTMLElement);
    expect(within(box).getByText(/3 regels van jou gelden niet op deze gedeelde rekening/)).toBeTruthy();

    // Converted: the server now says nothing is left to convert.
    api.accounts.mockImplementation(async () => [ZICHT, SPAAR, shared(0)]);
    const alertsBefore = api.alerts.mock.calls.length;
    fireEvent.click(within(box).getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toast()).toBe('3 regels omgezet'));
    expect(api.convertRules).toHaveBeenCalledTimes(1);
    expect(api.convertRules).toHaveBeenCalledWith(4);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Je regels' })).toBeNull());
    // The notice about these rules leaves the alerts with them.
    expect(api.alerts.mock.calls.length).toBeGreaterThan(alertsBefore);
  });

  it('speaks of one rule in the singular', async () => {
    const api = stubApi({ accounts: [ZICHT, shared(1)] });
    api.convertRules.mockResolvedValue({ converted: 1 });
    renderAt('/rekeningen/4');
    expect(await screen.findByText(/1 regel van jou geldt niet op deze gedeelde rekening/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toast()).toBe('1 regel omgezet'));
  });

  it('shows the server’s message and keeps the card when converting fails', async () => {
    const api = stubApi({ accounts: [ZICHT, shared(2)] });
    api.convertRules.mockRejectedValue(new ApiError(403, 'forbidden', 'Alleen de beheerder van de rekening kan dit.'));
    renderAt('/rekeningen/4');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    expect((await screen.findByRole('alert')).textContent).toBe('Alleen de beheerder van de rekening kan dit.');
    expect(screen.getByRole('heading', { name: 'Je regels' })).toBeTruthy();
    expect((screen.getByRole('button', { name: BUTTON }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('is not there when nothing needs converting, for a member, or on a personal account', async () => {
    stubApi({ accounts: [ZICHT, shared(0)] });
    const first = renderAt('/rekeningen/4');
    await screen.findByRole('heading', { level: 1, name: 'Gedeelde rekening' });
    expect(screen.queryByRole('heading', { name: 'Je regels' })).toBeNull();
    first.unmount();

    // Only the manager's rules are converted: a member never sees the card.
    const member = { ...asMember('edit'), convertibleRules: 2 };
    stubApi({ accounts: [ZICHT, member] });
    const second = renderAt('/rekeningen/4');
    await screen.findByRole('heading', { level: 1, name: 'Gedeelde rekening' });
    expect(screen.queryByRole('heading', { name: 'Je regels' })).toBeNull();
    second.unmount();

    stubApi({ accounts: [ZICHT, shared(0)] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(screen.queryByRole('heading', { name: 'Je regels' })).toBeNull();
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });
});

describe('Rekening · Leden (members and permissions)', () => {
  const toast = () => document.querySelector('.toast')?.textContent;
  const leden = () => screen.findByRole('heading', { name: 'Leden' }).then((h) => h.closest('section') as HTMLElement);
  const bewerkt = (box: HTMLElement, who: string) => within(within(box).getByRole('group', { name: 'Rechten van ' + who }));

  it('lists the members for the manager, who sets Lezen or Bewerken per member but not on their own row', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD] });
    renderAt('/rekeningen/4');
    const box = await leden();
    expect(within(box).getByText('2 leden · jij bent beheerder')).toBeTruthy();
    const rows = within(box).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Jij')).toBeTruthy();
    expect(within(rows[0]).getByText('Beheerder')).toBeTruthy();
    expect(within(rows[0]).getByText('sinds 3 juni 2026')).toBeTruthy();
    expect(within(rows[0]).getByText('Bewerken')).toBeTruthy();
    expect(within(rows[0]).queryByRole('group')).toBeNull();
    expect(within(rows[1]).getByText('Partner')).toBeTruthy();
    expect(within(rows[1]).getByText('Lid')).toBeTruthy();
    const perm = bewerkt(box, 'Partner');
    expect(perm.getByRole('button', { name: 'Bewerken' }).getAttribute('aria-pressed')).toBe('true');
    expect(perm.getByRole('button', { name: 'Lezen' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(box).getByText(/Alleen jij als beheerder past de rechten aan/)).toBeTruthy();
  });

  it('saves a change at once, says so, and keeps what the server answers; pressing the active option does nothing', async () => {
    const api = stubApi({ accounts: [ZICHT, GEDEELD] });
    renderAt('/rekeningen/4');
    const box = await leden();
    fireEvent.click(bewerkt(box, 'Partner').getByRole('button', { name: 'Bewerken' }));
    expect(api.setMemberPermission).not.toHaveBeenCalled();

    fireEvent.click(bewerkt(box, 'Partner').getByRole('button', { name: 'Lezen' }));
    await waitFor(() => expect(toast()).toBe('Partner mag nu alleen lezen'));
    expect(api.setMemberPermission).toHaveBeenCalledTimes(1);
    expect(api.setMemberPermission).toHaveBeenCalledWith(4, 2, 'read');
    expect(bewerkt(box, 'Partner').getByRole('button', { name: 'Lezen' }).getAttribute('aria-pressed')).toBe('true');
    expect(bewerkt(box, 'Partner').getByRole('button', { name: 'Bewerken' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(bewerkt(box, 'Partner').getByRole('button', { name: 'Bewerken' }));
    await waitFor(() => expect(toast()).toBe('Partner mag nu bewerken'));
    expect(api.setMemberPermission).toHaveBeenLastCalledWith(4, 2, 'edit');
  });

  it('shows the server’s message and keeps the choice when saving fails', async () => {
    const api = stubApi({ accounts: [ZICHT, GEDEELD] });
    api.setMemberPermission.mockRejectedValue(new ApiError(403, 'forbidden', 'Alleen de beheerder van de rekening kan dit.'));
    renderAt('/rekeningen/4');
    const box = await leden();
    fireEvent.click(bewerkt(box, 'Partner').getByRole('button', { name: 'Lezen' }));
    expect((await within(box).findByRole('alert')).textContent).toBe('Alleen de beheerder van de rekening kan dit.');
    expect(bewerkt(box, 'Partner').getByRole('button', { name: 'Bewerken' }).getAttribute('aria-pressed')).toBe('true');
    expect(toast()).toBeUndefined();
    // Free again for another try.
    api.setMemberPermission.mockClear();
    fireEvent.click(bewerkt(box, 'Partner').getByRole('button', { name: 'Lezen' }));
    await waitFor(() => expect(api.setMemberPermission).toHaveBeenCalledTimes(1));
  });

  it('is a plain list for a member who may edit, who also loses name, colour, buffer and balance', async () => {
    stubApi({ accounts: [ZICHT, asMember('edit')], connections: [] });
    const first = renderAt('/rekeningen/4');
    const box = await leden();
    expect(within(box).getByText('2 leden · Partner is beheerder')).toBeTruthy();
    expect(within(box).queryByRole('group')).toBeNull();
    expect(within(box).queryByRole('button')).toBeNull();
    const rows = within(box).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Partner')).toBeTruthy();
    expect(within(rows[0]).getByText('Beheerder')).toBeTruthy();
    expect(within(rows[1]).getByText('Jij')).toBeTruthy();
    expect(within(rows[1]).getByText('Lid')).toBeTruthy();
    expect(within(box).getByText(/Alleen de beheerder past de rechten aan/)).toBeTruthy();
    // Edit permission is for transactions and rules, not for the account's own settings.
    expect((screen.getByLabelText('Naam') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Minimumbuffer') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Blauw' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Opslaan' })).toBeNull();
    expect(screen.getByText('Partner (beheerder) past naam, kleur en buffer aan.')).toBeTruthy();
    expect(screen.queryByText('Alleen lezen')).toBeNull();
    first.unmount();

    // The balance of a manual account is the manager's too.
    stubApi({ accounts: [{ ...SPAAR, role: 'member' }] });
    renderAt('/rekeningen/2');
    await screen.findByRole('heading', { level: 1, name: 'Spaarrekening' });
    expect(screen.queryByRole('heading', { name: 'Saldo bijwerken' })).toBeNull();
  });

  it('is a plain list with the lock for a member who may only read', async () => {
    stubApi({ accounts: [ZICHT, asMember('read')], connections: [] });
    renderAt('/rekeningen/4');
    const box = await leden();
    expect(within(box).queryByRole('group')).toBeNull();
    expect(within(box).queryByRole('button')).toBeNull();
    expect(within(within(box).getAllByRole('listitem')[1]).getByText('Alleen lezen')).toBeTruthy();
    expect(within(within(box).getAllByRole('listitem')[0]).getByText('Bewerken')).toBeTruthy();
    // The page says so as well: the lock chip in the header, and the note above the settings.
    expect(document.querySelector('.rkd-ro-chip')?.textContent).toBe('Alleen lezen');
    expect(screen.getByText('Partner (beheerder) gaf je leesrechten op deze rekening.')).toBeTruthy();
  });

  it('has no Leden on a personal account', async () => {
    stubApi();
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(screen.queryByRole('heading', { name: 'Leden' })).toBeNull();
  });
});
