import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_MESSAGE } from '../lib/api';
import { MAX_IMPORT_BYTES, type ImportCounts, type ImportPreview, type RowError } from '../lib/imports';
import { ACCOUNTS, GEDEELD, IMPORT_COUNTS, IMPORT_ERRORS, IMPORT_PREVIEW, importResult, NEW_MANUAL, renderAt, SPAAR, stubApi, ZICHT } from '../test/helpers';
import { CHECK_DELAY_MS, UNSURE } from './Importeren';

const csv = (name = 'export-zicht.csv') => new File(['Boekingsdatum;Bedrag\n02/11/2026;-8,40\n'], name, { type: 'text/csv' });
const status = () => document.querySelector('.im-page > [role="status"]')!.textContent;
const MAPPING = IMPORT_PREVIEW.mapping;

async function choose(file: File) {
  await screen.findByRole('button', { name: 'Bestand kiezen' });
  fireEvent.change(screen.getByLabelText('CSV-bestand kiezen'), { target: { files: [file] } });
}

/** From the start view to step 2 with `file`. */
async function toColumns(file = csv()) {
  await choose(file);
  await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
  fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
  await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
}

/** To step 3, where the check says `n` new transactions. */
async function toCheck(file = csv(), n = 29) {
  await toColumns(file);
  fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Volgende' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
  await screen.findByRole('button', { name: 'Importeer ' + n + ' transacties' });
}

/** The check (a request with a mapping) answers with these counts and error lines. */
function answerCheck(api: ReturnType<typeof stubApi>, counts: ImportCounts, errors: RowError[]) {
  api.previewImport.mockImplementation(async (file, o = {}) => ({ ...IMPORT_PREVIEW, fileName: file.name, ...(o.mapping ? { counts, errors } : {}) }));
}

const goOffline = () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
};

const goOnline = () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
};

/** Long enough for a debounced check to have been sent, if the page would send one. */
const quiet = () => new Promise((r) => setTimeout(r, CHECK_DELAY_MS + 150));
const next = () => screen.getByRole('button', { name: 'Volgende' }) as HTMLButtonElement;

describe('Importeren · start', () => {
  it('lists the history with file, account, count and date, and offers no undo', async () => {
    stubApi();
    renderAt('/importeren');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const row = (await screen.findByText('argenta-zicht-oktober.csv')).closest('.im-batch') as HTMLElement;
    expect(within(row).getByText('Argenta-export · batch 3 · 12 november')).toBeTruthy();
    expect(within(row).getByText('Zichtrekening')).toBeTruthy();
    expect(within(row).getByText('42 transacties')).toBeTruthy();
    const old = screen.getByText('spaarrekening-2025.csv').closest('.im-batch') as HTMLElement;
    expect(within(old).getByText('CSV-bestand · batch 2 · 30 december 2025')).toBeTruthy();
    expect(within(old).getByText('Spaarrekening')).toBeTruthy();
    expect(screen.queryByText(/ongedaan/i)).toBeNull();
    expect(screen.queryByText(/Bilance/)).toBeNull();
  });

  it('says so when there is no import yet', async () => {
    stubApi({ imports: [] });
    renderAt('/importeren');
    expect(await screen.findByText('Nog geen imports')).toBeTruthy();
  });

  it('without accounts, points to Bank koppelen and a manual account', async () => {
    stubApi({ accounts: [], imports: [] });
    renderAt('/importeren');
    expect(await screen.findByRole('heading', { name: 'Eerst een rekening' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Bank koppelen/ }).getAttribute('href')).toBe('/bankkoppelingen');
    expect(screen.getByRole('link', { name: /Handmatige rekening maken/ }).getAttribute('href')).toBe('/rekeningen');
    expect(screen.queryByRole('button', { name: 'Bestand kiezen' })).toBeNull();
  });

  it('with read-only accounts only, explains why nothing can be imported', async () => {
    stubApi({ accounts: ACCOUNTS.map((a) => ({ ...a, permission: 'read' as const })) });
    renderAt('/importeren');
    expect(((await screen.findByRole('button', { name: 'Bestand kiezen' })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Op je rekeningen kan je alleen lezen/)).toBeTruthy();
  });

  it('refuses a file over 5 MiB and an empty file before uploading anything', async () => {
    const api = stubApi();
    renderAt('/importeren');
    await choose(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'groot.csv', { type: 'text/csv' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Dit bestand is groter dan 5 MB.');
    await choose(new File([], 'leeg.csv', { type: 'text/csv' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Dit bestand is leeg.');
    expect(api.previewImport).not.toHaveBeenCalled();
  });

  it('is unavailable offline', async () => {
    stubApi();
    renderAt('/importeren');
    await screen.findByRole('button', { name: 'Bestand kiezen' });
    goOffline();
    expect((screen.getByRole('button', { name: 'Bestand kiezen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Een bestand importeren kan weer zodra je verbinding hebt.')).toBeTruthy();
  });

  it('lets the picker offer the types Android gives bank CSV exports, and opens it from a real button', async () => {
    stubApi();
    renderAt('/importeren');
    const pick = await screen.findByRole('button', { name: 'Bestand kiezen' });
    const accept = screen.getByLabelText('CSV-bestand kiezen').getAttribute('accept')!.split(',');
    expect(accept).toEqual(expect.arrayContaining(['.csv', 'text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel']));
    const open = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(pick);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('Importeren · wizard', () => {
  it('goes through file, columns, check and result', async () => {
    const api = stubApi();
    renderAt('/importeren');
    const file = csv();
    await choose(file);
    expect(status()).toBe('Bezig met uploaden…');
    expect(screen.getAllByText('Bezig met uploaden…').length).toBeGreaterThan(0);

    // Step 1: what the server read; the heading has the focus.
    const h1 = await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    expect(document.activeElement).toBe(h1);
    expect(api.previewImport).toHaveBeenCalledTimes(1);
    expect(api.previewImport.mock.calls[0][0]).toBe(file);
    expect(api.previewImport.mock.calls[0][1]).toEqual({});
    expect(screen.getByText('Stap 1 van 4')).toBeTruthy();
    const steps = screen.getByRole('navigation', { name: 'Stappen van de import' });
    expect(within(steps).getAllByRole('listitem')[0].getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Lijkt een Argenta-export')).toBeTruthy();
    expect(screen.getByText('Puntkomma ( ; )')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));

    // Step 2: the suggested mapping, every field can be changed; no account chosen among three.
    const h2 = await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    expect(document.activeElement).toBe(h2);
    expect((screen.getByLabelText('Kolom ‘Boekdatum’ wordt') as HTMLSelectElement).value).toBe('date');
    expect((screen.getByLabelText('Kolom ‘Rekening’ wordt') as HTMLSelectElement).value).toBe('account');
    expect((screen.getByLabelText('Kolom ‘Munt’ wordt') as HTMLSelectElement).value).toBe('currency');
    expect((screen.getByLabelText('Kolom ‘Referentie’ wordt') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('-8,40 · 2.784,50 · -64,12')).toBeTruthy();
    expect(screen.getByText(/dienen als controle/)).toBeTruthy();
    expect(screen.getByText('Kies een rekening.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Volgende' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')!.querySelector('.im-radio-name')!.textContent)).toEqual(['Zichtrekening', 'Spaarrekening', 'Gedeelde rekening']);
    fireEvent.click(screen.getByRole('radio', { name: /Spaarrekening/ }));
    await waitFor(() => expect(next().disabled).toBe(false));
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(1); // the columns step asks the server nothing
    expect(status()).toBe('');
    fireEvent.click(next());

    // Step 3: one check with the final mapping and account; counts and the unreadable rows, by line.
    const h3 = await screen.findByRole('heading', { name: 'Controleer voor je importeert' });
    expect(document.activeElement).toBe(h3);
    await waitFor(() => expect(status()).toBe('29 nieuwe transacties van 31 rijen'));
    expect(api.previewImport).toHaveBeenCalledTimes(2);
    expect(api.previewImport.mock.calls[1][0]).toBe(file);
    expect(api.previewImport.mock.calls[1][1]).toEqual({ accountId: SPAAR.id, mapping: MAPPING });
    expect(screen.getByText('Dit is wat er in je Spaarrekening komt.')).toBeTruthy();
    const stats = document.querySelector('.im-stats') as HTMLElement;
    expect([...stats.querySelectorAll('.im-stat')].map((s) => s.textContent)).toEqual(['29nieuw', '1al in Saldo', '1onleesbaar']);
    expect(screen.getByText('Regel 7')).toBeTruthy();
    expect(screen.getByText('Het bedrag is niet leesbaar.')).toBeTruthy();
    const alertsBefore = api.alerts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));

    // Step 4: the result, links onward, no undo.
    const h4 = await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(document.activeElement).toBe(h4);
    expect(api.importFile).toHaveBeenCalledWith(file, SPAAR.id, MAPPING, expect.any(AbortSignal));
    expect(screen.getByText('In je Spaarrekening. Bewaard als batch 12.')).toBeTruthy();
    expect(screen.getByText('Stap 4 van 4')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Transacties bekijken/ }).getAttribute('href')).toBe('/transacties?rekening=' + SPAAR.id);
    expect(screen.getByRole('button', { name: /Nog een bestand importeren/ })).toBeTruthy();
    expect(screen.queryByText(/ongedaan/i)).toBeNull();
    // The uncategorised badge and the history load again.
    await waitFor(() => expect(api.alerts.mock.calls.length).toBeGreaterThan(alertsBefore));
    expect(api.imports).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Terug naar Importeren' }).at(-1)!);
    const top = await screen.findByRole('heading', { level: 1, name: 'Importeren' });
    expect(document.activeElement).toBe(top);
  });

  it('preselects the only account the viewer may edit and leaves read-only accounts out', async () => {
    stubApi({ accounts: [ZICHT, { ...GEDEELD, permission: 'read' }] });
    renderAt('/importeren');
    await toColumns();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect((screen.getByRole('radio', { name: /Zichtrekening/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Gedeelde rekening')).toBeNull();
    expect(screen.getByText(/Rekeningen waarop je alleen kan lezen, staan er niet bij/)).toBeTruthy();
  });

  it('blocks continuing while Datum or Bedrag is missing or a field is chosen twice, without asking the server', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await toColumns();

    fireEvent.change(screen.getByLabelText('Kolom ‘Boekdatum’ wordt'), { target: { value: '' } });
    expect(screen.getByText('Kies nog een kolom voor Datum.')).toBeTruthy();
    expect(next().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Kolom ‘Boekdatum’ wordt'), { target: { value: 'date' } });
    fireEvent.change(screen.getByLabelText('Kolom ‘Referentie’ wordt'), { target: { value: 'amount' } });
    expect(screen.getByText('Elke soort mag maar bij één kolom staan.')).toBeTruthy();
    expect(screen.getAllByText('Ook gekozen bij een andere kolom')).toHaveLength(2);
    expect(next().disabled).toBe(true);
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(1);
  });

  it('checks when the check step opens, aborts that request on a step back, and ignores the answer to the older request', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    const pending: { mapping: ImportPreview['mapping']; resolve: (p: ImportPreview) => void; signal?: AbortSignal }[] = [];
    api.previewImport.mockImplementation((file, o = {}, signal) => {
      if (!o.mapping) return Promise.resolve({ ...IMPORT_PREVIEW, fileName: file.name });
      return new Promise((resolve) => pending.push({ mapping: o.mapping!, resolve, signal }));
    });
    renderAt('/importeren');
    await toColumns();
    await quiet();
    expect(pending).toHaveLength(0);
    fireEvent.click(next());
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(status()).toBe('Bezig met controleren…');

    fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
    expect(pending[0].signal?.aborted).toBe(true);
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    fireEvent.change(screen.getByLabelText('Kolom ‘Mededeling’ wordt'), { target: { value: '' } });
    fireEvent.click(next());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].mapping).toEqual({ ...MAPPING, communication: null });

    const answer = (n: number): ImportPreview => ({ ...IMPORT_PREVIEW, counts: { ...IMPORT_COUNTS, new: n, present: 30 - n }, errors: [] });
    await act(async () => pending[1].resolve(answer(5)));
    await act(async () => pending[0].resolve(answer(99)));
    expect(status()).toBe('5 nieuwe transacties van 31 rijen');
    expect(await screen.findByRole('button', { name: 'Importeer 5 transacties' })).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('offers the account and currency columns and sends them with the check and the import', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await toColumns();
    const options = within(screen.getByLabelText('Kolom ‘Referentie’ wordt')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Rekening van het bestand');
    expect(options).toContain('Munt');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(api.previewImport.mock.calls.at(-1)?.[1]).toEqual({ accountId: ZICHT.id, mapping: expect.objectContaining({ account: 0, currency: 6 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(api.importFile.mock.calls[0][2]).toMatchObject({ account: 0, currency: 6 });
  });

  it('sends nothing for changes in the columns step; one check with the final columns and account when the check step opens, a new one only after a change', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR] });
    renderAt('/importeren');
    await toColumns();
    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    fireEvent.change(screen.getByLabelText('Kolom ‘Munt’ wordt'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Kolom ‘Rekening’ wordt'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: /Spaarrekening/ }));
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(1);

    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(api.previewImport).toHaveBeenCalledTimes(2);
    expect(api.previewImport.mock.calls[1][1]).toEqual({ accountId: SPAAR.id, mapping: { ...MAPPING, currency: null, account: null } });

    // Back and forward without a change keeps the counts it has.
    fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(2);

    // A changed account or mapping is checked again, once.
    fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    fireEvent.change(screen.getByLabelText('Kolom ‘Munt’ wordt'), { target: { value: 'currency' } });
    fireEvent.click(next());
    await waitFor(() => expect(api.previewImport).toHaveBeenCalledTimes(3));
    expect(api.previewImport.mock.calls[2][1]).toEqual({ accountId: ZICHT.id, mapping: { ...MAPPING, account: null } });
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(3);
  });

  it('says the file account is checked only when the chosen account has an IBAN', async () => {
    stubApi({ accounts: [ZICHT, NEW_MANUAL] });
    renderAt('/importeren');
    await toColumns();
    const withIban = /rijen van een andere rekening dan de gekozen, of niet in euro, importeert Saldo niet/;
    const noIban = /De gekozen rekening heeft geen IBAN, dus Saldo kan niet controleren bij welke rekening het bestand hoort/;

    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    expect(screen.getByText(withIban)).toBeTruthy();
    expect(screen.queryByText(noIban)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Vakantiepot/ }));
    expect(screen.getByText(noIban)).toBeTruthy();
    expect(screen.getByText(/rijen die niet in euro zijn, importeert Saldo niet/)).toBeTruthy();
    expect(screen.queryByText(withIban)).toBeNull();
  });

  it('warns, without the account having an IBAN, that a file with rows of more than one account is refused', async () => {
    stubApi({ accounts: [ZICHT, NEW_MANUAL] });
    renderAt('/importeren');
    await toColumns();
    const several = /Staan er rijen van meer dan één rekening in het bestand, dan importeert Saldo het niet/;

    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    expect(screen.queryByText(several)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Vakantiepot/ }));
    expect(screen.getByText(several)).toBeTruthy();
  });

  it('when the server refuses a file with several accounts for an account without IBAN, says nothing comes in and blocks the import', async () => {
    const api = stubApi({ accounts: [NEW_MANUAL] });
    const message = 'Het bestand bevat rijen van meer dan één rekening en de gekozen rekening heeft geen IBAN.';
    answerCheck(api, { rows: 31, new: 0, present: 0, invalid: 31, overlap: 0 }, [{ line: 2, message }]);
    renderAt('/importeren');
    await toColumns();
    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 0 transacties' });
    expect(screen.getByText('Er komt niets bij: elke rij staat al in Saldo of is onleesbaar.')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Importeer 0 transacties' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.importFile).not.toHaveBeenCalled();
  });

  it.each([
    [4, '4 nieuwe regels vallen in de periode die de bank al synchroniseert; controleer op dubbels.'],
    [1234, '1.234 nieuwe regels vallen in de periode die de bank al synchroniseert; controleer op dubbels.'],
    [1, '1 nieuwe regel valt in de periode die de bank al synchroniseert; controleer op dubbels.'],
  ])('warns calmly in the check step when %i new rows lie in the period the bank already syncs, and still lets the import go on', async (overlap, text) => {
    const api = stubApi({ accounts: [ZICHT] });
    answerCheck(api, { ...IMPORT_COUNTS, new: 1500, overlap }, IMPORT_ERRORS);
    renderAt('/importeren');
    await toColumns();
    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 1.500 transacties' });
    // A polite status message, not an alert, with the consequence in a second line.
    const note = screen.getAllByRole('status').find((s) => s.textContent?.includes(text))!;
    expect(note).toBeTruthy();
    expect(within(note).getByText(text)).toBeTruthy();
    expect(note.textContent).toContain('Saldo slaat rijen over die er al staan als ze precies hetzelfde zijn.');
    expect(screen.queryByRole('alert')).toBeNull();
    // Information only: the button stays enabled and the import goes through.
    const button = screen.getByRole('button', { name: 'Importeer 1.500 transacties' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(screen.queryByText(/de periode die de bank al synchroniseert/)).toBeNull();
  });

  it.each([
    ['0', IMPORT_COUNTS],
    ['absent', { rows: 31, new: 29, present: 1, invalid: 1 }],
  ])('shows no overlap warning when the overlap is %s', async (_name, counts) => {
    const api = stubApi({ accounts: [ZICHT] });
    answerCheck(api, counts, IMPORT_ERRORS);
    renderAt('/importeren');
    await toCheck();
    expect(screen.queryByText(/de periode die de bank al synchroniseert/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Importeer 29 transacties' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offline in the check step shows the offline note instead of a running check, and carries on when the connection is back', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await toColumns();
    goOffline();
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Controleer voor je importeert' });
    expect(screen.getByText('De controle gaat verder zodra je verbinding hebt.')).toBeTruthy();
    expect(screen.queryByText('Bezig met controleren…')).toBeNull();
    expect(status()).toBe('');
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(1);

    goOnline();
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(screen.queryByText(/De controle gaat verder/)).toBeNull();
    expect(api.previewImport).toHaveBeenCalledTimes(2);
  });

  it('stops a running check when the connection drops, and says so', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    const signals: (AbortSignal | undefined)[] = [];
    api.previewImport.mockImplementation((file, o = {}, signal) => {
      if (!o.mapping) return Promise.resolve({ ...IMPORT_PREVIEW, fileName: file.name });
      signals.push(signal);
      return new Promise(() => undefined);
    });
    renderAt('/importeren');
    await toColumns();
    fireEvent.click(next());
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(status()).toBe('Bezig met controleren…');

    goOffline();
    expect(signals[0]?.aborted).toBe(true);
    expect(status()).toBe('');
    expect(screen.queryByText('Bezig met controleren…')).toBeNull();
    expect(screen.getByText('De controle gaat verder zodra je verbinding hebt.')).toBeTruthy();
  });

  it('keeps a retry after a failed check, only in the check step, and a retry that works replaces the error', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    let down = true;
    api.previewImport.mockImplementation(async (file, o = {}) => {
      if (o.mapping && down) throw new ApiError(0, 'network', NETWORK_MESSAGE);
      return { ...IMPORT_PREVIEW, fileName: file.name, ...(o.mapping ? { counts: IMPORT_COUNTS, errors: IMPORT_ERRORS } : {}) };
    });
    renderAt('/importeren');
    await toColumns();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(next());
    expect((await screen.findByRole('alert')).textContent).toContain(NETWORK_MESSAGE);

    // Back in the columns step there is no error and no retry that would do nothing; coming back asks again.
    fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(next());
    await waitFor(() => expect(api.previewImport).toHaveBeenCalledTimes(3));
    await screen.findByRole('alert');

    down = false;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.previewImport).toHaveBeenCalledTimes(4);
  });

  it('sends null for the account and currency when both are set to Negeren, and still continues', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await toColumns();
    for (const name of ['Rekening', 'Munt']) fireEvent.change(screen.getByLabelText('Kolom ‘' + name + '’ wordt'), { target: { value: '' } });
    expect(screen.queryByText(/Kies nog een kolom/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(api.previewImport.mock.calls.at(-1)?.[1]?.mapping).toEqual({ ...MAPPING, account: null, currency: null });
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(api.importFile.mock.calls[0][2]).toEqual({ ...MAPPING, account: null, currency: null });
  });

  it('shows the rows refused for another account or currency as plain text, a masked IBAN included', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    answerCheck(api, { rows: 31, new: 27, present: 2, invalid: 2 }, [
      { line: 3, message: 'Rekening BE68 •••• •••• 4821 in het bestand is niet de gekozen rekening.' },
      { line: 4, message: 'Alleen bedragen in euro worden ondersteund.' },
    ]);
    renderAt('/importeren');
    await toCheck(csv(), 27);
    const list = document.querySelector('.im-errs') as HTMLElement;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Regel 3Rekening BE68 •••• •••• 4821 in het bestand is niet de gekozen rekening.',
      'Regel 4Alleen bedragen in euro worden ondersteund.',
    ]);
    expect(screen.getByText('2 overgeslagen')).toBeTruthy();
  });

  it('when every row belongs to another account, says nothing comes in and blocks the import', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    answerCheck(api, { rows: 31, new: 0, present: 0, invalid: 31 }, [{ line: 2, message: 'Rekening BE68 •••• •••• 4821 in het bestand is niet de gekozen rekening.' }]);
    renderAt('/importeren');
    await toCheck(csv(), 0);
    expect(screen.getByText('Er komt niets bij: elke rij staat al in Saldo of is onleesbaar.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Importeer 0 transacties' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('En nog 30 rijen.')).toBeTruthy();
    expect(api.importFile).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Dit is geen CSV-bestand dat Saldo kan lezen.'],
    [413, 'Het bestand is groter dan 5 MB.'],
    [415, 'Kies een CSV-bestand.'],
  ])('shows the message of a %i when reading the file', async (code, message) => {
    const api = stubApi();
    api.previewImport.mockRejectedValueOnce(new ApiError(code, 'x', message));
    renderAt('/importeren');
    await choose(csv());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(within(alert).queryByRole('button', { name: 'Opnieuw proberen' })).toBeNull();
  });

  it('shows a 429 with how long to wait', async () => {
    const api = stubApi();
    api.previewImport.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'Even geduld: probeer het straks opnieuw.', 30));
    renderAt('/importeren');
    await choose(csv());
    expect((await screen.findByRole('alert')).textContent).toContain('Even geduld: probeer het straks opnieuw. Wacht nog 30 seconden.');
  });

  it.each([
    [403, 'Op deze rekening kan je alleen lezen.'],
    [404, 'Deze rekening bestaat niet.'],
    [400, 'Dit bestand hoort bij een andere rekening dan de gekozen rekening.'],
    [400, 'Het bestand bevat rijen van meer dan één rekening en de gekozen rekening heeft geen IBAN.'],
  ])('shows the message of a %i from the import', async (code, message) => {
    const api = stubApi({ accounts: [ZICHT] });
    api.importFile.mockRejectedValueOnce(new ApiError(code, 'x', message));
    renderAt('/importeren');
    await toCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('keeps the file after a network error at reading, for a retry', async () => {
    const api = stubApi();
    api.previewImport.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    renderAt('/importeren');
    const file = csv();
    await choose(file);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NETWORK_MESSAGE);
    fireEvent.click(within(alert).getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    expect(api.previewImport).toHaveBeenCalledTimes(2);
    expect(api.previewImport.mock.calls[1][0]).toBe(file);
  });

  it('after a network error at the import says it is not certain, points to the history, and retries with the same file', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    api.importFile.mockRejectedValueOnce(new ApiError(0, 'network', NETWORK_MESSAGE));
    renderAt('/importeren');
    const file = csv();
    await toCheck(file);
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(UNSURE);
    expect(UNSURE).toContain('niet zeker');
    expect(within(alert).getByRole('button', { name: 'Naar de geschiedenis' })).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(api.importFile).toHaveBeenCalledTimes(2);
    expect(api.importFile.mock.calls[1][0]).toBe(file);
  });

  it('sends one import for a double click', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    let done: (v: ReturnType<typeof importResult>) => void = () => undefined;
    api.importFile.mockImplementation(() => new Promise((r) => (done = r)));
    renderAt('/importeren');
    await toCheck();
    const button = screen.getByRole('button', { name: 'Importeer 29 transacties' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(status()).toBe('Bezig met importeren…');
    expect(api.importFile).toHaveBeenCalledTimes(1);
    await act(async () => done(importResult('export-zicht.csv', ZICHT.id)));
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
  });

  it('keeps the screen but blocks the import when the connection drops', async () => {
    stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await toCheck();
    goOffline();
    expect((screen.getByRole('button', { name: 'Importeer 29 transacties' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Importeren kan weer zodra je verbinding hebt.')).toBeTruthy();
    expect(screen.getByText('29')).toBeTruthy();
  });

  it('aborts a running upload when going back', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    renderAt('/importeren');
    await choose(csv());
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    let signal: AbortSignal | undefined;
    api.previewImport.mockImplementation((_f, _o, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    fireEvent.change(screen.getByLabelText('CSV-bestand kiezen'), { target: { files: [csv('ander.csv')] } });
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Terug naar Importeren' }));
    expect(signal!.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Bestand kiezen' })).toHaveProperty('disabled', false);
  });

  it('aborts a running import when leaving the page', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    let signal: AbortSignal | undefined;
    api.importFile.mockImplementation((_f, _a, _m, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const view = renderAt('/importeren');
    await toCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
