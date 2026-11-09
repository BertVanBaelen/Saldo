import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CATEGORISE_ALERT, CONSENT_ALERT, EB_OFF, EB_ON, GEDEELD, PENDING, renderAt, SPAAR, stubApi, ZICHT } from '../test/helpers';
import type { Account, Alert, SyncStatus } from '../lib/types';

const hero = () => document.querySelector('.hero') as HTMLElement;
/** The text of every account subline, in page order. */
const subs = () => Array.from(document.querySelectorAll('.row-sub')).map((e) => e.textContent);
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
    expect(within(hero()).queryByText(/Stand van/)).toBeNull();
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

describe('Start · welkom (no accounts yet)', () => {
  // The three step links in order, and what each one shows.
  const steps = () => within(document.querySelector('ol.start-steps') as HTMLElement).getAllByRole('link');
  const hrefs = () => steps().map((a) => a.getAttribute('href'));
  const next = () => steps().map((a) => !!a.querySelector('.start-step-num--next'));
  const done = () => steps().map((a) => !!a.querySelector('.start-step-num svg'));

  it('starts at the Enable Banking step while no key is stored', async () => {
    stubApi({ accounts: [], alerts: [], connections: [], enableBanking: EB_OFF });
    renderAt('/');
    expect(await screen.findByText('0 van 3 klaar')).toBeTruthy();
    expect(hrefs()).toEqual(['/instellingen/enable-banking', '/bankkoppelingen', '/importeren']);
    expect(next()).toEqual([true, false, false]);
    expect(done()).toEqual([false, false, false]);
    expect(within(steps()[0]).getByText('(volgende stap)')).toBeTruthy();
    expect(within(steps()[2]).getByText('Optioneel · een CSV-bestand, bv. de export uit Argenta')).toBeTruthy();
  });

  it('marks the Enable Banking step done once the key is stored, and moves on to linking a bank', async () => {
    stubApi({ accounts: [], alerts: [], connections: [], enableBanking: EB_ON });
    renderAt('/');
    expect(await screen.findByText('1 van 3 klaar')).toBeTruthy();
    expect(done()).toEqual([true, false, false]);
    expect(next()).toEqual([false, true, false]);
    expect(within(steps()[0]).getByText('(klaar)')).toBeTruthy();
    expect(within(steps()[1]).getByText('(volgende stap)')).toBeTruthy();
    expect(hrefs()).toEqual(['/instellingen/enable-banking', '/bankkoppelingen', '/importeren']);
  });

  it('continues a link that was started but not finished at its own page', async () => {
    stubApi({ accounts: [], alerts: [], connections: [PENDING], enableBanking: EB_ON });
    renderAt('/');
    expect(await screen.findByText('1 van 3 klaar')).toBeTruthy();
    expect(hrefs()[1]).toBe('/bankkoppelingen/koppelen?koppeling=3');
    expect(next()).toEqual([false, true, false]);
    // The link goes to a real page: the wizard that re-authorises that connection.
    fireEvent.click(steps()[1]);
    expect(await screen.findByText('Toestemming vernieuwen bij Argenta')).toBeTruthy();
  });

  it('takes step 1 from the stored key, not from a connection that already exists', async () => {
    stubApi({ accounts: [], alerts: [], connections: [PENDING], enableBanking: EB_OFF });
    renderAt('/');
    expect(await screen.findByText('0 van 3 klaar')).toBeTruthy();
    expect(next()).toEqual([true, false, false]);
    expect(done()).toEqual([false, false, false]);
  });

  it('shows the plain first steps when the extra requests fail', async () => {
    const api = stubApi({ accounts: [], alerts: [] });
    api.enableBanking.mockRejectedValue(new Error('x'));
    api.connections.mockRejectedValue(new Error('x'));
    renderAt('/');
    expect(await screen.findByText('Welkom bij Saldo')).toBeTruthy();
    expect(screen.getByText('0 van 3 klaar')).toBeTruthy();
    expect(hrefs()).toEqual(['/instellingen/enable-banking', '/bankkoppelingen', '/importeren']);
    expect(next()).toEqual([true, false, false]);
  });

  it('never counts the optional import as done and shows no figures, alerts or sync button', async () => {
    stubApi({ accounts: [], alerts: [CONSENT_ALERT], connections: [], enableBanking: EB_ON });
    renderAt('/');
    await screen.findByText('1 van 3 klaar');
    expect(done()[2]).toBe(false);
    expect(document.querySelector('.alerts')).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Welke rekeningen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nu synchroniseren' })).toBeNull();
  });
});

describe('Start · alerts', () => {
  const STOPPED: Alert = { kind: 'neg', type: 'sync', title: 'Synchronisatie gestopt · Argenta', note: 'Niet bijgewerkt sinds zondag 04:02', href: '/bankkoppelingen' };
  const STALE: Alert = { kind: 'warn', type: 'sync', title: 'Zichtrekening niet bijgewerkt sinds zondag 04:02', note: 'Argenta stuurde geen nieuwe gegevens', href: '/bankkoppelingen' };
  const PLANNING: Alert = { kind: 'warn', type: 'planning', title: 'Zichtrekening zakt in de buffer in januari', note: 'Verwacht € 722', href: '/planning' };
  const rows = () => Array.from(document.querySelectorAll('.alerts .alert')) as HTMLAnchorElement[];

  it('shows the alerts of the server in the order it sends them', async () => {
    stubApi({ alerts: [CATEGORISE_ALERT, CONSENT_ALERT, STOPPED, STALE] });
    renderAt('/');
    await screen.findByText(STALE.title);
    expect(rows().map((r) => r.querySelector('strong')?.textContent)).toEqual([CATEGORISE_ALERT.title, CONSENT_ALERT.title, STOPPED.title, STALE.title]);
    expect(rows().map((r) => r.className)).toEqual(['alert alert--ok', 'alert alert--warn', 'alert alert--neg', 'alert alert--warn']);
    expect(rows().map((r) => r.getAttribute('href'))).toEqual(['/transacties?filter=niet-gecategoriseerd', '/bankkoppelingen', '/bankkoppelingen', '/bankkoppelingen']);
    expect(within(rows()[2]).getByText('Niet bijgewerkt sinds zondag 04:02')).toBeTruthy();
  });

  it('shows a chevron on every alert except one that leads to Planning (desktop hides them in CSS)', async () => {
    stubApi({ alerts: [STOPPED, PLANNING, CONSENT_ALERT] });
    renderAt('/');
    await screen.findByText(PLANNING.title);
    expect(rows().map((r) => !!r.querySelector('.chev'))).toEqual([true, false, true]);
  });

  it('shows an alert about one account only when that account is in the scope; the others always show', async () => {
    const STALE_SHARED: Alert = { ...STALE, title: 'Gedeelde rekening niet bijgewerkt sinds zondag 04:02', accountId: 4 };
    const STALE_PERSONAL: Alert = { ...STALE, accountId: 1 };
    stubApi({ alerts: [STOPPED, STALE_PERSONAL, STALE_SHARED, CONSENT_ALERT] });
    renderAt('/');
    await screen.findByText(STALE_SHARED.title);
    const titles = () => rows().map((r) => r.querySelector('strong')?.textContent);
    const all = [STOPPED.title, STALE_PERSONAL.title, STALE_SHARED.title, CONSENT_ALERT.title];
    expect(titles()).toEqual(all);

    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));
    expect(titles()).toEqual([STOPPED.title, STALE_PERSONAL.title, CONSENT_ALERT.title]);
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    expect(titles()).toEqual([STOPPED.title, STALE_SHARED.title, CONSENT_ALERT.title]);
    fireEvent.click(screen.getByRole('button', { name: 'Alles' }));
    expect(titles()).toEqual(all);
  });

  it('hides the whole alerts block when its only alert is about an account outside the scope', async () => {
    stubApi({ alerts: [{ ...STALE, title: 'Gedeelde rekening niet bijgewerkt sinds zondag 04:02', accountId: 4 }] });
    renderAt('/');
    await screen.findByText('Gedeelde rekening niet bijgewerkt sinds zondag 04:02');
    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));
    expect(document.querySelector('.alerts')).toBeNull();
  });

  it('shows no alerts block when there is nothing to warn about', async () => {
    stubApi({ alerts: [] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(document.querySelector('.alerts')).toBeNull();
  });
});

describe('Start · sync states', () => {
  it('shows a failed sync on the account and the date of its balance in the hero', async () => {
    stubApi({ accounts: [{ ...ZICHT, syncStatus: 'failed', lastSync: '2026-11-17T04:02:00+01:00' }], alerts: [] });
    renderAt('/');
    const sub = await screen.findByText('Argenta · synchronisatie mislukt');
    expect(sub.classList.contains('start-sub--neg')).toBe(true);
    expect(within(hero()).getByText('Stand van gisteren 04:02')).toBeTruthy();
  });

  it('shows a stale account in the warn colour, with the date of its balance', async () => {
    stubApi({ accounts: [{ ...ZICHT, syncStatus: 'stale', lastSync: '2026-11-15T04:02:00+01:00', balanceDate: '2026-11-15' }], alerts: [] });
    renderAt('/');
    const sub = await screen.findByText('Argenta · laatst bijgewerkt zondag 04:02');
    expect(sub.classList.contains('start-sub--warn')).toBe(true);
    expect(within(hero()).getByText('Stand van zondag 04:02')).toBeTruthy();
  });

  it('shows Synchroniseren… on the bank accounts while a sync runs, then loads the data again', async () => {
    const api = stubApi();
    let finish = () => {};
    api.syncStatus.mockImplementationOnce(
      () =>
        new Promise<SyncStatus>((resolve) => {
          finish = () => resolve({ running: false, startedAt: null, finishedAt: null, connections: [] });
        }),
    );
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(subs()).toEqual(['Argenta · vandaag 04:02', 'Handmatig · bijgewerkt 2 okt', 'Argenta · vandaag 04:02']);

    fireEvent.click(screen.getByRole('button', { name: 'Nu synchroniseren' }));
    const busy = await screen.findByRole('button', { name: 'Bezig met synchroniseren' });
    expect(busy.querySelector('.spin')).not.toBeNull();
    expect(document.querySelector('.progress')).not.toBeNull();
    // Bank accounts sync; the manual savings account keeps its own line.
    expect(subs()).toEqual(['Synchroniseren…', 'Handmatig · bijgewerkt 2 okt', 'Synchroniseren…']);

    api.accounts.mockImplementation(async () => [{ ...ZICHT, balance: 200000 }, SPAAR, GEDEELD]);
    await act(async () => finish());
    expect(await screen.findByRole('button', { name: 'Nu synchroniseren' })).toBeTruthy();
    expect(document.querySelector('.progress')).toBeNull();
    expect(subs()).toEqual(['Argenta · vandaag 04:02', 'Handmatig · bijgewerkt 2 okt', 'Argenta · vandaag 04:02']);
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(api.accounts).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('€ 2.000,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Gesynchroniseerd')).toBeTruthy();
  });

  it('leaves an unlinked account alone while a sync runs', async () => {
    const api = stubApi({ accounts: [{ ...ZICHT, syncStatus: 'unlinked', lastSync: null }] });
    api.syncStatus.mockImplementationOnce(() => new Promise<SyncStatus>(() => {}));
    renderAt('/');
    await screen.findByText('Argenta · niet meer gekoppeld');
    fireEvent.click(screen.getByRole('button', { name: 'Nu synchroniseren' }));
    await screen.findByRole('button', { name: 'Bezig met synchroniseren' });
    expect(subs()).toEqual(['Argenta · niet meer gekoppeld']);
  });

  it('keeps the sync button focusable but marked unavailable while offline, and explains itself with a toast', async () => {
    const api = stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    const button = screen.getByRole('button', { name: 'Synchroniseren kan niet: je bent offline' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(await screen.findByText('Offline · synchroniseren kan niet')).toBeTruthy();
    expect(api.sync).not.toHaveBeenCalled();
    // The figures stay visible.
    expect(within(hero()).getByText('€ 2.914,90')).toBeTruthy();
  });
});

describe('Start · without a current account in view', () => {
  it('shows a calm card instead of a hero when there are savings accounts only, and still lists them', async () => {
    stubApi({ accounts: [SPAAR] });
    renderAt('/');
    expect(await screen.findByText('Nog geen zichtrekening')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bank koppelen' }).getAttribute('href')).toBe('/bankkoppelingen');
    expect(document.querySelector('.hero')).toBeNull();
    expect(screen.queryByText('Komende maanden')).toBeNull();
    expect(screen.getByText('Spaarrekening')).toBeTruthy();
    expect(screen.getByText('€ 12.500,00')).toBeTruthy();
    // The alerts above it stay.
    expect(await screen.findByText(CONSENT_ALERT.title)).toBeTruthy();
  });

  it('does the same when the scope leaves only the savings account', async () => {
    stubApi({ accounts: [SPAAR, GEDEELD] });
    renderAt('/');
    await screen.findByText('Saldo nu · Gedeelde rekening');
    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));
    expect(screen.getByText('Nog geen zichtrekening')).toBeTruthy();
    expect(document.querySelector('.hero')).toBeNull();
    expect(screen.getByText('Spaarrekening')).toBeTruthy();
    expect(screen.queryByText('Gedeelde rekening')).toBeNull();
  });

  it('says there is no shared account when the scope has none of its kind', async () => {
    stubApi({ accounts: [ZICHT, SPAAR] });
    renderAt('/');
    await screen.findByText('Saldo nu · Zichtrekening');
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    expect(screen.getByText('Nog geen gedeelde rekening')).toBeTruthy();
    expect(document.querySelector('.hero')).toBeNull();
  });
});
