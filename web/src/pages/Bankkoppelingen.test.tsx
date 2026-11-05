import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, browser } from '../lib/api';
import type { BankLinkResult, Connection } from '../lib/types';
import { connectionsSub } from './Meer';
import { CONNECTIONS, EB_OFF, GEDEELD, ME, renderAt, renderRoot, stubApi, ZICHT } from '../test/helpers';

const where = () => screen.getByTestId('location').textContent;
const toast = () => document.querySelector('.toast')?.textContent;
const card = (bank: string) => screen.getByText(bank, { selector: '.bk-conn-name' }).closest('article') as HTMLElement;
const conn = (c: Partial<Connection>): Connection => ({ ...CONNECTIONS[0], ...c });

const BANK_URL = 'https://bank.example.com/consent/abc';
// Invented single-use values, as the bank would put them in the address.
const CODE = 'c0de-7f3a91';
const STATE = 'st4te-b25e04';

describe('Bankkoppelingen', () => {
  it('lists a connection: the accounts it feeds, consent, last sync, and the warning before the consent lapses', async () => {
    stubApi();
    renderAt('/bankkoppelingen');
    const c = (await screen.findByText('Argenta', { selector: '.bk-conn-name' })).closest('article') as HTMLElement;
    const v = within(c);
    expect(v.getByText('Nog 12 dagen')).toBeTruthy();
    expect(v.getByText('Leest 2 rekeningen')).toBeTruthy();
    expect(v.getByText(ZICHT.name)).toBeTruthy();
    expect(v.getByText(GEDEELD.name)).toBeTruthy();
    expect(v.getByText(ZICHT.iban!)).toBeTruthy();
    expect(v.getByText('Toestemming tot 30 november 2026 · nog 12 dagen')).toBeTruthy();
    expect(v.getByText('Laatst gesynchroniseerd vandaag 04:02')).toBeTruthy();
    expect(v.getByText('Gekoppeld sinds 3 juni 2026')).toBeTruthy();
    // 12 days left: re-authorising is the main action.
    expect(v.getByRole('link', { name: 'Opnieuw autoriseren' }).className).toContain('bk-btn--primary');
  });

  it('shows each status in the mockup’s words', async () => {
    stubApi({
      connections: [
        conn({ id: 1, bank: 'Bank A', daysLeft: 120, status: 'ok' }),
        conn({ id: 2, bank: 'Bank B', status: 'stale' }),
        conn({ id: 3, bank: 'Bank C', status: 'failed' }),
        conn({ id: 4, bank: 'Bank D', daysLeft: 0, status: 'expired' }),
        // The server sends null dates until the bank has answered (saving the Enable Banking key creates this row).
        conn({ id: 5, bank: 'Bank E', status: 'pending', accounts: [], lastSync: null, since: null, validUntil: null, daysLeft: null }),
      ],
    });
    renderAt('/bankkoppelingen');
    await screen.findByText('Bank A', { selector: '.bk-conn-name' });

    const a = within(card('Bank A'));
    expect(a.getByText('Actief')).toBeTruthy();
    expect(a.getByRole('link', { name: 'Opnieuw autoriseren' }).className).toContain('bk-btn--ghost');
    expect(within(card('Bank B')).getByText('Verouderd')).toBeTruthy();
    expect(within(card('Bank B')).getByText('Niet bijgewerkt sinds vandaag 04:02')).toBeTruthy();
    expect(within(card('Bank C')).getByText('Mislukt')).toBeTruthy();
    expect(within(card('Bank C')).getByText('De laatste synchronisatie is mislukt')).toBeTruthy();
    expect(within(card('Bank C')).queryByRole('button', { name: 'Nu synchroniseren' })).toBeNull();
    expect(within(card('Bank D')).getByText('Gestopt')).toBeTruthy();
    expect(within(card('Bank D')).getByText('Toestemming verlopen op 30 november 2026')).toBeTruthy();
    const e = within(card('Bank E'));
    expect(e.getByText('Niet afgerond')).toBeTruthy();
    expect(e.getByText('Nog niet gesynchroniseerd')).toBeTruthy();
    expect(e.getByRole('link', { name: 'Opnieuw autoriseren' }).getAttribute('href')).toBe('/bankkoppelingen/koppelen?koppeling=5');
  });

  it('syncs now and shows the server’s message when it is too soon', async () => {
    const stub = stubApi();
    stub.sync.mockRejectedValue(new ApiError(429, 'rate_limited', 'Je synchroniseerde net. Probeer het over 15 minuten opnieuw.', 900));
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nu synchroniseren' }));
    expect(stub.sync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast()).toBe('Je synchroniseerde net. Probeer het over 15 minuten opnieuw.'));
  });

  it('re-authorises a connection: explanation, then POST /api/bank/link with its id and off to the bank', async () => {
    stubApi();
    const link = vi.spyOn(api, 'startLink').mockResolvedValue({ url: BANK_URL });
    const go = vi.spyOn(browser, 'go').mockImplementation(() => undefined);
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('link', { name: 'Opnieuw autoriseren' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Toestemming vernieuwen bij Argenta' })).toBeTruthy();
    expect(where()).toBe('/bankkoppelingen/koppelen?koppeling=1');
    expect(screen.getByText(/Je toestemming loopt tot 30 november 2026, nog 12 dagen\./)).toBeTruthy();
    expect(link).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Naar Argenta' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Je gaat naar Argenta…' })).toBeTruthy();
    expect(link).toHaveBeenCalledWith(1);
    expect(go).toHaveBeenCalledWith(BANK_URL);
  });

  it('links a first bank from the empty state, and shows the server’s error', async () => {
    stubApi({ connections: [] });
    const link = vi.spyOn(api, 'startLink').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Enable Banking is niet bereikbaar. Probeer het later opnieuw.')).mockResolvedValue({ url: BANK_URL });
    const go = vi.spyOn(browser, 'go').mockImplementation(() => undefined);
    renderAt('/bankkoppelingen');

    expect(await screen.findByRole('heading', { name: 'Nog geen bank gekoppeld' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Bank koppelen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bevestigen bij Argenta' })).toBeTruthy();
    expect(screen.getByText(/In de Argenta-app, met je Digipass of met itsme/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Naar Argenta' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enable Banking is niet bereikbaar. Probeer het later opnieuw.');
    expect(go).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Naar Argenta' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(BANK_URL));
    expect(link).toHaveBeenLastCalledWith(undefined);
  });

  it('points to Instellingen → Enable Banking first while no app is set up', async () => {
    stubApi({ connections: [], enableBanking: EB_OFF });
    renderAt('/bankkoppelingen');
    expect(await screen.findByRole('heading', { name: 'Eerst je eigen app bij Enable Banking' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Naar Instellingen/ }).getAttribute('href')).toBe('/instellingen/enable-banking');
    expect(screen.queryByRole('link', { name: 'Bank koppelen' })).toBeNull();
  });

  it('keeps the links on Start working', async () => {
    stubApi({ accounts: [] });
    renderAt('/');
    expect((await screen.findByRole('link', { name: /Enable Banking instellen/ })).getAttribute('href')).toBe('/instellingen/enable-banking');
    fireEvent.click(screen.getByRole('link', { name: /^Bank koppelen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bankkoppelingen' })).toBeTruthy();
  });
});

const RESULT: BankLinkResult = {
  connection: { ...CONNECTIONS[0], since: '2026-11-18', validUntil: '2027-05-17', daysLeft: 180, accounts: [1] },
  accounts: [ZICHT],
  skipped: [{ iban: 'BE12 •••• •••• 7730', reason: 'exists' }],
};

describe('Back from the bank', () => {
  it('takes the code and state out of the address, posts them once (also in StrictMode) and shows what was linked', async () => {
    stubApi();
    const callback = vi.spyOn(api, 'bankCallback').mockResolvedValue(RESULT);
    renderAt('/bankkoppelingen/terug?code=' + CODE + '&state=' + STATE, ME, true);

    expect(await screen.findByRole('heading', { level: 1, name: 'Klaar. Je rekening is gekoppeld.' })).toBeTruthy();
    // The address is cleaned in an effect; the router applies it a moment after the result shows.
    await waitFor(() => expect(where()).toBe('/bankkoppelingen/terug'));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(CODE, STATE);
    expect(screen.getByText(ZICHT.name)).toBeTruthy();
    expect(screen.getByText('Eén rekening is overgeslagen')).toBeTruthy();
    expect(screen.getByText(/BE12 •••• •••• 7730 staat al in Saldo bij een andere gebruiker/)).toBeTruthy();
    expect(screen.getByText('Toestemming tot 17 mei 2027.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(document.body.innerHTML).not.toContain(CODE);
    expect(document.body.innerHTML).not.toContain(STATE);
  });

  it('shows the server’s error with a way to try again', async () => {
    stubApi();
    vi.spyOn(api, 'bankCallback').mockRejectedValue(new ApiError(400, 'invalid', 'Deze koppelpoging is verlopen of al gebruikt. Begin opnieuw.'));
    renderAt('/bankkoppelingen/terug?code=' + CODE + '&state=' + STATE);

    expect(await screen.findByRole('heading', { level: 1, name: 'Koppelen lukt niet' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Deze koppelpoging is verlopen of al gebruikt. Begin opnieuw.');
    expect(screen.getByRole('link', { name: 'Opnieuw proberen' }).getAttribute('href')).toBe('/bankkoppelingen');
    // The address is cleaned in an effect; the router applies it a moment after the result shows.
    await waitFor(() => expect(where()).toBe('/bankkoppelingen/terug'));
  });

  it('says when the first sync failed, and when nothing came back from the bank', async () => {
    const stub = stubApi();
    stub.syncStatus.mockResolvedValue({ running: false, startedAt: null, finishedAt: null, connections: [{ id: 1, status: 'failed', lastSync: null, error: 'http_500' }] });
    const callback = vi.spyOn(api, 'bankCallback').mockResolvedValue({ ...RESULT, skipped: [] });
    const first = renderAt('/bankkoppelingen/terug?code=' + CODE + '&state=' + STATE);
    expect(await screen.findByText('De eerste synchronisatie is mislukt')).toBeTruthy();
    expect(screen.queryByText(/Je transacties en je saldo zijn binnen/)).toBeNull();
    first.unmount();

    // Cancelled at the bank: nothing to post.
    renderAt('/bankkoppelingen/terug?error=access_denied&state=' + STATE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Koppelen geannuleerd' })).toBeTruthy();
    // The address is cleaned in an effect; the router applies it a moment after the result shows.
    await waitFor(() => expect(where()).toBe('/bankkoppelingen/terug'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-out visitor to sign-in and back with the code and state, then posts them', async () => {
    stubApi();
    let signedIn = false;
    vi.spyOn(api, 'me').mockImplementation(async () => {
      if (!signedIn) throw new ApiError(401, 'unauthorized', 'Je bent niet aangemeld.');
      return ME;
    });
    vi.spyOn(api, 'login').mockResolvedValue({ challenge: 'ch-1', email: 'b•••@example.com' });
    vi.spyOn(api, 'verify').mockImplementation(async () => {
      signedIn = true;
      return { user: ME.user };
    });
    const callback = vi.spyOn(api, 'bankCallback').mockResolvedValue(RESULT);
    renderRoot('/bankkoppelingen/terug?code=' + CODE + '&state=' + STATE);

    expect(await screen.findByRole('heading', { level: 1, name: 'Inloggen' })).toBeTruthy();
    expect(callback).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('E-mailadres'), { target: { value: 'bert@example.com' } });
    fireEvent.change(screen.getByLabelText('Wachtwoord'), { target: { value: 'paard batterij nietje correct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verder' }));
    fireEvent.change(await screen.findByLabelText('Code uit de e-mail'), { target: { value: '48291736' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Klaar. Je rekening is gekoppeld.' })).toBeTruthy();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(CODE, STATE);
    // The address is cleaned in an effect; the router applies it a moment after the result shows.
    await waitFor(() => expect(where()).toBe('/bankkoppelingen/terug'));
  });

  it('explains the page when it is opened without an answer from the bank', async () => {
    stubApi();
    const callback = vi.spyOn(api, 'bankCallback');
    renderAt('/bankkoppelingen/terug');
    expect(await screen.findByRole('heading', { level: 1, name: 'Niets om af te ronden' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Naar Bankkoppelingen' }).getAttribute('href')).toBe('/bankkoppelingen');
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('Meer · bankkoppelingen summary', () => {
  it('calls a link that is not finished unfinished, not expired', () => {
    const pending = conn({ status: 'pending', accounts: [], lastSync: null, since: null, validUntil: null, daysLeft: null });
    expect(connectionsSub([pending])).toEqual({ sub: 'Argenta · koppelen niet afgerond', tone: 'warn' });
  });
});
