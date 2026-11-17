import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { asMember, CATEGORISE_ALERT, CONSENT_ALERT, EB_OFF, EB_ON, GEDEELD, ME, MEMBER_ALERT, PENDING, renderAt, RULES_ALERT, SPAAR, stubApi, ZICHT } from '../test/helpers';
import type { Account, Alert, ReportMonths, ReportQuery, Scope, SyncStatus } from '../lib/types';

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
    stubApi({ accounts: [ZICHT, asMember('read')] });
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

  it('has no "te categoriseren" alert in a scope where the server counts none', async () => {
    // The server counts only the accounts in the scope; Gedeeld has nothing open here.
    stubApi({ accounts: [ZICHT, GEDEELD], alerts: (scope) => (scope === 'gedeeld' ? [CONSENT_ALERT] : [CONSENT_ALERT, CATEGORISE_ALERT]) });
    renderAt('/');
    await screen.findByText(CATEGORISE_ALERT.title);
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    await waitFor(() => expect(screen.queryByText(CATEGORISE_ALERT.title)).toBeNull());
    expect(screen.getByText(CONSENT_ALERT.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alles' }));
    expect(await screen.findByText(CATEGORISE_ALERT.title)).toBeTruthy();
  });

  it('shows no alerts block when there is nothing to warn about', async () => {
    stubApi({ alerts: [] });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(document.querySelector('.alerts')).toBeNull();
  });
});

describe('Start · dismissable alerts (a member joined, rules no longer apply)', () => {
  const rows = () => Array.from(document.querySelectorAll('.alerts .alert'));
  const toast = () => document.querySelector('.toast')?.textContent;

  it('shows both like the other alerts, a link to the account each, and a labelled close button only on a notice', async () => {
    stubApi({ alerts: [MEMBER_ALERT, RULES_ALERT, CONSENT_ALERT] });
    renderAt('/');
    await screen.findByText(MEMBER_ALERT.title);
    expect(rows().map((r) => r.className)).toEqual(['alert alert--ok alert--notice', 'alert alert--warn alert--notice', 'alert alert--warn']);
    // The link and the button are siblings: a button inside a link is not valid.
    for (const [row, alert] of [[rows()[0], MEMBER_ALERT], [rows()[1], RULES_ALERT]] as const) {
      const link = within(row as HTMLElement).getByRole('link');
      expect(link.getAttribute('href')).toBe('/rekeningen/4');
      expect(link.textContent).toContain(alert.title);
      expect(link.textContent).toContain(alert.note);
      expect(link.querySelector('button')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Sluiten: ' + MEMBER_ALERT.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sluiten: ' + RULES_ALERT.title })).toBeTruthy();
    expect(within(rows()[2] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('marks the notice as read and the alert leaves; the others stay', async () => {
    const stub = stubApi({ alerts: [MEMBER_ALERT, RULES_ALERT, CONSENT_ALERT] });
    renderAt('/');
    await screen.findByText(MEMBER_ALERT.title);
    const before = stub.alerts.mock.calls.length;
    // After the read mark the server no longer sends it.
    stub.alerts.mockResolvedValue([RULES_ALERT, CONSENT_ALERT]);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten: ' + MEMBER_ALERT.title }));

    await waitFor(() => expect(screen.queryByText(MEMBER_ALERT.title)).toBeNull());
    expect(stub.readNotice).toHaveBeenCalledTimes(1);
    expect(stub.readNotice).toHaveBeenCalledWith(7);
    expect(stub.alerts.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByText(RULES_ALERT.title)).toBeTruthy();
    expect(screen.getByText(CONSENT_ALERT.title)).toBeTruthy();
  });

  it('keeps the alert and says why when the read mark fails', async () => {
    const stub = stubApi({ alerts: [MEMBER_ALERT] });
    stub.readNotice.mockRejectedValue(new ApiError(404, 'not_found', 'Deze melding bestaat niet meer.'));
    renderAt('/');
    await screen.findByText(MEMBER_ALERT.title);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten: ' + MEMBER_ALERT.title }));

    await waitFor(() => expect(toast()).toBe('Deze melding bestaat niet meer.'));
    expect(screen.getByText(MEMBER_ALERT.title)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sluiten: ' + MEMBER_ALERT.title }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an alert about the shared account only when that account is in the scope', async () => {
    stubApi({ alerts: [MEMBER_ALERT] });
    renderAt('/');
    await screen.findByText(MEMBER_ALERT.title);
    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));
    expect(screen.queryByText(MEMBER_ALERT.title)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    expect(screen.getByText(MEMBER_ALERT.title)).toBeTruthy();
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

describe('Start · Uitgaven november', () => {
  // The demo answers of 0.7-1 for November 2026 to the 18th (plan 0.7-5). Keys are category ids (1 Wonen, 2 Boodschappen,
  // 3 Vrije tijd, 4 Vervoer, 5 Abonnementen) and the pseudo keys. Each account counts its own transfers; the total does not.
  const ZICHT_NOV: Record<string, number> = { '1': 100500, toShared: 45000, '4': 13410, '3': 6690, none: 4125, '5': 2598 }; // 172323
  const GEDEELD_NOV: Record<string, number> = { '2': 29521, '1': 14500, '5': 4298 }; // 48319
  const TOTAL_NOV: Record<string, number> = { '1': 115000, '2': 29521, '4': 13410, '3': 6690, none: 4125, '5': 6896 }; // 175642, no transfer
  const flows = (expenses: Record<string, number>) => ({ income: 0, saved: 0, expenses });
  const report = (accounts: number[], expenses: Record<string, number>, perAccount?: [number, Record<string, number>][], month = '2026-11'): ReportMonths => ({
    accounts,
    firstMonth: '2025-11',
    firstDate: '2025-11-01',
    months: [{ month, ...flows(expenses), accounts: perAccount?.map(([id, e]) => ({ id, ...flows(e) })) }],
  });
  const alles = () =>
    report(
      [1, 4],
      TOTAL_NOV,
      [
        [1, ZICHT_NOV],
        [4, GEDEELD_NOV],
      ],
    );
  const byScope = (q: ReportQuery) => (q.scope === 'persoonlijk' ? report([1], ZICHT_NOV) : q.scope === 'gedeeld' ? report([4], GEDEELD_NOV) : alles());
  const inScope = (scope: Scope) => ({ ...ME, preferences: { ...ME.preferences, scope } });
  const FOOTNOTE = 'Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen.';
  const ZICHT_ROWS = [
    ['Wonen 58%', '€ 1.005,00'],
    ['Naar gedeelde rekening 26%', '€ 450,00'],
    ['Vervoer 8%', '€ 134,10'],
    ['Vrije tijd 4%', '€ 66,90'],
    ['Niet gecategoriseerd 2%', '€ 41,25'],
    ['Abonnementen 2%', '€ 25,98'],
  ];
  const GEDEELD_ROWS = [
    ['Boodschappen 61%', '€ 295,21'],
    ['Wonen 30%', '€ 145,00'],
    ['Abonnementen 9%', '€ 42,98'],
  ];

  const heading = () => screen.findByRole('heading', { name: /^Uitgaven [a-z]+$/ });
  const card = () => screen.getByRole('heading', { name: /^Uitgaven [a-z]+$/ }).closest('section') as HTMLElement;
  const rowsOf = (root: ParentNode) => Array.from(root.querySelectorAll('.share-row')).map((r) => [r.querySelector('.name')!.textContent, r.querySelector('.amount')!.textContent]);
  const groups = () => Array.from(card().querySelectorAll('.start-spend-group')) as HTMLElement[];
  const groupHead = (g: HTMLElement) => [g.querySelector('.start-spend-name')!.textContent, g.querySelector('.start-spend-head .mono')!.textContent];
  const loading = () => screen.queryByRole('status', { name: 'Uitgaven laden' });

  it('shows a block per account in Alles, "samen" as the total and the footnote about the transfer', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/');
    await heading();
    expect(screen.getByRole('heading', { name: 'Uitgaven november' })).toBeTruthy();
    expect(api.reportMonths).toHaveBeenCalledTimes(1);
    expect(api.reportMonths.mock.calls[0][0]).toEqual({ scope: 'alles', from: '2026-11', to: '2026-11' });

    expect(groups().map(groupHead)).toEqual([
      ['Zichtrekening', '€ 1.723,23'],
      ['Gedeelde rekening', '€ 483,19'],
    ]);
    expect(rowsOf(groups()[0])).toEqual(ZICHT_ROWS);
    expect(rowsOf(groups()[1])).toEqual(GEDEELD_ROWS);

    // The head: the report's total, which leaves the € 450 between the own accounts out.
    const samen = screen.getByRole('link', { name: 'Samen € 1.756,42, ter info' });
    expect(samen.textContent).toBe('samen € 1.756,42');
    // The footnote sits under the card, outside the link.
    expect(screen.getByText(FOOTNOTE).closest('a')).toBeNull();
  });

  it('draws the share bar from the rows, a dashed dot for "Niet gecategoriseerd"', async () => {
    stubApi({ reports: byScope });
    renderAt('/');
    await heading();
    const segments = Array.from(groups()[0].querySelectorAll('.share-bar > span')) as HTMLElement[];
    expect(segments).toHaveLength(6);
    expect(segments[0].style.width).toBe('58.3%');
    expect(groups()[0].querySelector('.share-bar')!.getAttribute('aria-hidden')).toBe('true');
    const dots = Array.from(groups()[0].querySelectorAll('.share-row i')) as HTMLElement[];
    expect(dots.map((d) => d.classList.contains('start-spend-dot--uncat'))).toEqual([false, false, false, false, true, false]);
  });

  it('shows one block in Persoonlijk with the transfer row, the total in the head and no footnote', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/', inScope('persoonlijk'));
    await heading();
    expect(api.reportMonths.mock.calls[0][0]).toEqual({ scope: 'persoonlijk', from: '2026-11', to: '2026-11' });
    expect(groups()).toHaveLength(0);
    expect(rowsOf(card())).toEqual(ZICHT_ROWS);
    const total = card().querySelector('.section-meta') as HTMLElement;
    expect(total.textContent).toBe('€ 1.723,23');
    expect(total.getAttribute('aria-label')).toBeNull();
    expect(screen.queryByText(/Overschrijvingen tussen je eigen rekeningen/)).toBeNull();
  });

  it('shows one block in Gedeeld', async () => {
    stubApi({ reports: byScope });
    renderAt('/', inScope('gedeeld'));
    await heading();
    expect(groups()).toHaveLength(0);
    expect(rowsOf(card())).toEqual(GEDEELD_ROWS);
    expect(card().querySelector('.section-meta')!.textContent).toBe('€ 483,19');
    expect(screen.queryByText(/Overschrijvingen tussen je eigen rekeningen/)).toBeNull();
  });

  it('links the head and the card to Overzicht', async () => {
    stubApi({ reports: byScope });
    renderAt('/');
    await heading();
    const links = within(card()).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/overzicht', '/overzicht']);
    expect(links[1].classList.contains('card')).toBe(true);
  });

  it('says so for an account without spending, and uses the month of today, not a fixed one', async () => {
    const api = stubApi({
      reports: () =>
        report(
          [1, 4],
          { '1': 100500 },
          [
            [1, { '1': 100500 }],
            [4, {}],
          ],
          '2026-12',
        ),
    });
    renderAt('/', { ...ME, today: '2026-12-02' });
    expect(await screen.findByRole('heading', { name: 'Uitgaven december' })).toBeTruthy();
    expect(api.reportMonths.mock.calls[0][0]).toEqual({ scope: 'alles', from: '2026-12', to: '2026-12' });
    expect(groups().map(groupHead)).toEqual([
      ['Zichtrekening', '€ 1.005,00'],
      ['Gedeelde rekening', '€ 0,00'],
    ]);
    expect(within(groups()[1]).getByText('Nog niets uitgegeven in december.')).toBeTruthy();
    expect(groups()[1].querySelector('.share-bar')).toBeNull();
  });

  it('says so when the only account has no spending', async () => {
    stubApi({ accounts: [ZICHT], reports: () => report([1], {}) });
    renderAt('/');
    await heading();
    expect(screen.getByText('Nog niets uitgegeven in november.')).toBeTruthy();
    expect(card().querySelector('.section-meta')!.textContent).toBe('€ 0,00');
  });

  it('leaves the card out when the report fails, and the rest of Start stays', async () => {
    const api = stubApi({ reports: byScope });
    api.reportMonths.mockRejectedValue(new Error('x'));
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    await waitFor(() => expect(api.reportMonths).toHaveBeenCalled());
    await waitFor(() => expect(loading()).toBeNull());
    expect(screen.queryByRole('heading', { name: /^Uitgaven / })).toBeNull();
    expect(screen.getByText('Alleen jij ziet deze rekeningen')).toBeTruthy();
    expect(screen.getByText('Met Partner · jij bent beheerder')).toBeTruthy();
  });

  it('shows no card, and asks for nothing, in a scope without a current account', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR], reports: byScope });
    renderAt('/', inScope('gedeeld'));
    expect(await screen.findByText('Nog geen gedeelde rekening')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Uitgaven / })).toBeNull();
    expect(loading()).toBeNull();
    expect(api.reportMonths).not.toHaveBeenCalled();
  });

  it('shows no card for savings accounts only', async () => {
    const api = stubApi({ accounts: [SPAAR], reports: byScope });
    renderAt('/');
    expect(await screen.findByText('Nog geen zichtrekening')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Uitgaven / })).toBeNull();
    expect(api.reportMonths).not.toHaveBeenCalled();
  });

  it('holds its place with a skeleton while the report loads, and never shows the answer of another scope', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/');
    await heading();
    expect(groups()).toHaveLength(2);

    // The next scope's answer is slow: the Alles blocks do not stand in for it.
    api.reportMonths.mockImplementation(() => new Promise<ReportMonths>(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijk' }));
    expect(await screen.findByRole('status', { name: 'Uitgaven laden' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Uitgaven / })).toBeNull();
    expect(api.reportMonths.mock.calls.at(-1)![0]).toEqual({ scope: 'persoonlijk', from: '2026-11', to: '2026-11' });
  });

  it('loads again after a sync (a dataVersion bump) and shows the new amounts', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/');
    await heading();
    expect(groupHead(groups()[1])).toEqual(['Gedeelde rekening', '€ 483,19']);

    let finish = (_r: ReportMonths) => {};
    api.reportMonths.mockImplementation(() => new Promise<ReportMonths>((resolve) => (finish = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Nu synchroniseren' }));
    await waitFor(() => expect(api.reportMonths).toHaveBeenCalledTimes(2), { timeout: 3000 });
    // The old amounts stay on screen while the new answer is on its way: no skeleton in between.
    expect(loading()).toBeNull();
    expect(groupHead(groups()[1])).toEqual(['Gedeelde rekening', '€ 483,19']);
    await act(async () =>
      finish(
        report(
          [1, 4],
          { ...TOTAL_NOV, '2': 1000 },
          [
            [1, ZICHT_NOV],
            [4, { '2': 1000 }],
          ],
        ),
      ),
    );
    await waitFor(() => expect(groupHead(groups()[1])).toEqual(['Gedeelde rekening', '€ 10,00']));
  });
});
