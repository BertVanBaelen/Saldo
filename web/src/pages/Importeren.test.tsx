import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_MESSAGE } from '../lib/api';
import { MAX_IMPORT_BYTES, type ImportCounts, type ImportPreview, type RowError } from '../lib/imports';
import { ACCOUNTS, GEDEELD, IMPORT_COUNTS, IMPORT_ERRORS, IMPORT_PREVIEW, importResult, NEW_MANUAL, renderAt, SPAAR, stubApi, ZICHT } from '../test/helpers';
import { choose as pick } from '../test/select';
import { CHECK_DELAY_MS, UNSURE } from './Importeren';

/** The select that says what a file column becomes. */
const col = (name: string) => screen.getByRole('combobox', { name: 'Kolom ‘' + name + '’ wordt' });
const csv = (name = 'export-zicht.csv') => new File(['Boekingsdatum;Bedrag\n02/11/2026;-8,40\n'], name, { type: 'text/csv' });
const status = () => document.querySelector('.im-page > [role="status"]')!.textContent;
const MAPPING = IMPORT_PREVIEW.mapping;

/**
 * The element, in the microtask right after the commit that adds it. React's scheduler is made to yield after every
 * task, like a busy machine, so no post-paint effect has run yet: what the test checks next has to hold in that
 * commit, not a tick later.
 */
function shown<T extends HTMLElement>(find: () => T | null) {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
  return new Promise<T>((resolve) => {
    const check = () => {
      const el = find();
      if (!el) return;
      seen.disconnect();
      clock.mockRestore();
      resolve(el);
    };
    const seen = new MutationObserver(check);
    seen.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

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
  onward();
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
/** From the columns step through the categories step to the check. */
const onward = () => {
  fireEvent.click(next());
  fireEvent.click(next());
};
/** From the check step back to the columns step. */
const backToColumns = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
  fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
};

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

  it('refuses a file over 20 MiB and an empty file before uploading anything', async () => {
    const api = stubApi();
    renderAt('/importeren');
    await choose(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'groot.csv', { type: 'text/csv' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Dit bestand is groter dan 20 MB.');
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
  it('goes through file, columns, categories, check and result', async () => {
    const api = stubApi();
    renderAt('/importeren');
    const file = csv();
    await choose(file);
    expect(status()).toBe('Bezig met uploaden…');
    expect(screen.getAllByText('Bezig met uploaden…').length).toBeGreaterThan(0);

    // Step 1: what the server read; the heading has the focus.
    const h1 = await shown(() => screen.queryByRole('heading', { name: 'Welk bestand importeer je?' }));
    expect(document.activeElement).toBe(h1);
    expect(api.previewImport).toHaveBeenCalledTimes(1);
    expect(api.previewImport.mock.calls[0][0]).toBe(file);
    expect(api.previewImport.mock.calls[0][1]).toEqual({});
    expect(screen.getByText('Stap 1 van 5')).toBeTruthy();
    const steps = screen.getByRole('navigation', { name: 'Stappen van de import' });
    expect(within(steps).getAllByRole('listitem')[0].getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Lijkt een Argenta-export')).toBeTruthy();
    expect(screen.getByText('Puntkomma ( ; )')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));

    // Step 2: the suggested mapping, every field can be changed; no account chosen among three.
    const h2 = await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    expect(document.activeElement).toBe(h2);
    expect(col('Boekdatum').textContent).toBe('Datum');
    expect(col('Rekening').textContent).toBe('Rekening van het bestand');
    expect(col('Munt').textContent).toBe('Munt');
    expect(col('Referentie').textContent).toBe('Negeren');
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

    // Step 3: no category column, so nothing to map; still a visible step.
    const h3 = await screen.findByRole('heading', { name: 'Koppel de categorieën' });
    expect(document.activeElement).toBe(h3);
    expect(screen.getByText('Geen categorie-kolom.')).toBeTruthy();
    fireEvent.click(next());

    // Step 4: one check with the final mapping and account; counts and the unreadable rows, by line.
    const h4 = await screen.findByRole('heading', { name: 'Controleer voor je importeert' });
    expect(document.activeElement).toBe(h4);
    await waitFor(() => expect(status()).toBe('29 nieuwe transacties van 31 rijen'));
    expect(api.previewImport).toHaveBeenCalledTimes(2);
    expect(api.previewImport.mock.calls[1][0]).toBe(file);
    expect(api.previewImport.mock.calls[1][1]).toEqual({ target: SPAAR.id, mapping: MAPPING });
    expect(screen.getByText('Dit is wat er in je Spaarrekening komt.')).toBeTruthy();
    const stats = document.querySelector('.im-stats') as HTMLElement;
    expect([...stats.querySelectorAll('.im-stat')].map((s) => s.textContent)).toEqual(['29nieuw', '1al in Saldo', '1onleesbaar']);
    expect(screen.getByText('Regel 7')).toBeTruthy();
    expect(screen.getByText('Het bedrag is niet leesbaar.')).toBeTruthy();
    const alertsBefore = api.alerts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));

    // Step 5: the result, links onward, no undo.
    const h5 = await shown(() => screen.queryByRole('heading', { name: '29 transacties geïmporteerd' }));
    expect(document.activeElement).toBe(h5);
    expect(api.importFile).toHaveBeenCalledWith(file, SPAAR.id, MAPPING, expect.any(AbortSignal), undefined, undefined, undefined);
    expect(screen.getByText('In je Spaarrekening. Bewaard als batch 12.')).toBeTruthy();
    expect(screen.getByText('Stap 5 van 5')).toBeTruthy();
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

    pick(col('Boekdatum'), 'Negeren');
    expect(screen.getByText('Kies nog een kolom voor Datum.')).toBeTruthy();
    expect(next().disabled).toBe(true);

    pick(col('Boekdatum'), 'Datum');
    pick(col('Referentie'), 'Bedrag');
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
    onward();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(status()).toBe('Bezig met controleren…');

    backToColumns();
    expect(pending[0].signal?.aborted).toBe(true);
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    pick(col('Mededeling'), 'Negeren');
    onward();
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
    fireEvent.click(col('Referentie'));
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Rekening van het bestand');
    expect(options).toContain('Munt');
    onward();
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(api.previewImport.mock.calls.at(-1)?.[1]).toEqual({ target: ZICHT.id, mapping: expect.objectContaining({ account: 0, currency: 6 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 29 transacties' }));
    await screen.findByRole('heading', { name: '29 transacties geïmporteerd' });
    expect(api.importFile.mock.calls[0][2]).toMatchObject({ account: 0, currency: 6 });
  });

  it('sends nothing for changes in the columns step; one check with the final columns and account when the check step opens, a new one only after a change', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR] });
    renderAt('/importeren');
    await toColumns();
    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    pick(col('Munt'), 'Negeren');
    pick(col('Rekening'), 'Negeren');
    fireEvent.click(screen.getByRole('radio', { name: /Spaarrekening/ }));
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(1);

    onward();
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    expect(api.previewImport).toHaveBeenCalledTimes(2);
    expect(api.previewImport.mock.calls[1][1]).toEqual({ target: SPAAR.id, mapping: { ...MAPPING, currency: null, account: null } });

    // Back and forward without a change keeps the counts it has.
    fireEvent.click(screen.getByRole('button', { name: 'Vorige' }));
    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 29 transacties' });
    await quiet();
    expect(api.previewImport).toHaveBeenCalledTimes(2);

    // A changed account or mapping is checked again, once.
    backToColumns();
    fireEvent.click(screen.getByRole('radio', { name: /Zichtrekening/ }));
    pick(col('Munt'), 'Munt');
    onward();
    await waitFor(() => expect(api.previewImport).toHaveBeenCalledTimes(3));
    expect(api.previewImport.mock.calls[2][1]).toEqual({ target: ZICHT.id, mapping: { ...MAPPING, account: null } });
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
    onward();
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
    onward();
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
    onward();
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
    onward();
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
    onward();
    expect((await screen.findByRole('alert')).textContent).toContain(NETWORK_MESSAGE);

    // Back in the columns step there is no error and no retry that would do nothing; coming back asks again.
    backToColumns();
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    expect(screen.queryByRole('alert')).toBeNull();
    onward();
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
    for (const name of ['Rekening', 'Munt']) pick(col(name), 'Negeren');
    expect(screen.queryByText(/Kies nog een kolom/)).toBeNull();
    onward();
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
    [413, 'Het bestand is groter dan 20 MB.'],
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

describe('Importeren · Bilance', () => {
  const HEADERS = ['Titel', 'Datum', 'Bedrag', 'Categorie', 'Subcategorie', 'Tag(s)', 'Betalingskenmerk', 'Handelaar', 'Rekening(en)', 'Notitie'];
  const BILANCE: ImportPreview = {
    ...IMPORT_PREVIEW,
    fileName: 'bilance.csv',
    delimiter: ',',
    headers: HEADERS,
    preset: 'bilance',
    mapping: { ...IMPORT_PREVIEW.mapping, account: null, valueDate: null, currency: null, counterpartyIban: null, date: 1, amount: 2, counterparty: 7, counterpartyFallback: 0,
      communication: 6, category: 3, subcategory: 4, accountName: 8, note: 9 },
    sample: [['Voorbeeld Winkel', '2026-11-02 00:00:00.000', '-170.00€', 'Eten & Drinken', 'Boodschappen', '', 'Voorbeeld Winkel 02-11-2026 Antwerpen', 'Voorbeeld Winkel Antwerpen', 'Zichtrekening', '']],
  };
  const NAMES = { accounts: [{ name: 'Spaarrekening', rows: 4 }, { name: 'Zichtrekening', rows: 26 }],
    // The first pair has a saved target (Boodschappen), the second a suggestion by name (Wonen › Energie), the last none.
    categories: [
      { category: 'Eten & Drinken', subcategory: 'Boodschappen', rows: 12, total: -45000, saved: { categoryId: 2 }, suggestion: 2 },
      { category: 'Wonen', subcategory: 'Energie, nutsvoorzieningen', rows: 3, total: -30000, saved: null, suggestion: 10 },
      { category: '', subcategory: '', rows: 1, total: -500, saved: null, suggestion: null },
    ] };

  /** The server answers a Bilance file: the suggestion, the names and categories with a mapping, counts with the accounts too. */
  function bilanceApi() {
    const api = stubApi({ accounts: [ZICHT, SPAAR] });
    api.previewImport.mockImplementation(async (file, o = {}) => ({
      ...BILANCE,
      fileName: file.name,
      ...(o.mapping ? NAMES : {}),
      ...(o.mapping && o.target !== undefined ? { counts: { rows: 30, new: 28, present: 1, invalid: 1, overlap: 0 }, errors: IMPORT_ERRORS } : {}),
    }));
    return api;
  }

  it('reaches the check with the account names mapped, lists the category pairs read-only, and sends the map', async () => {
    const api = bilanceApi();
    renderAt('/importeren');
    const file = csv('bilance.csv');
    await choose(file);
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    expect(screen.getByText('Lijkt een Bilance-export')).toBeTruthy();
    expect(screen.getByText('Komma ( , )')).toBeTruthy();
    fireEvent.click(next());

    // Columns: the preset's mapping, the account names to map (nothing is picked among two accounts).
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    expect(col('Rekening(en)').textContent).toBe('Rekeningnaam');
    expect(col('Subcategorie').textContent).toBe('Subcategorie');
    expect(col('Titel').textContent).toBe('Tegenpartij als die leeg is');
    expect(await screen.findByText('Naam in het bestand')).toBeTruthy();
    expect([...document.querySelectorAll('.im-mapacc-name')].map((n) => n.textContent)).toEqual(['Spaarrekening', 'Zichtrekening']);
    expect(screen.getByText('Koppel elke rekeningnaam aan een rekening.')).toBeTruthy();
    expect(next().disabled).toBe(true);
    expect(api.previewImport).toHaveBeenCalledTimes(2); // the file, then the names and categories
    expect(api.previewImport.mock.calls[1][1]).toEqual({ mapping: BILANCE.mapping });
    pick(screen.getByRole('combobox', { name: 'Rekening in Saldo voor Spaarrekening' }), 'Spaarrekening');
    pick(screen.getByRole('combobox', { name: 'Rekening in Saldo voor Zichtrekening' }), 'Zichtrekening');
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());

    // Categories: the pairs as the file has them, the saved target labelled Opgeslagen and the suggestion Voorstel,
    // both shown in their select; a pair without a category stays fixed on "Niet categoriseren".
    await screen.findByRole('heading', { name: 'Koppel de categorieën' });
    expect(await screen.findByText('Energie, nutsvoorzieningen')).toBeTruthy();
    expect(screen.getAllByText(/Wonen >/)).toHaveLength(1);
    expect(screen.getByText('Zonder categorie')).toBeTruthy();
    const rows = [...document.querySelectorAll('.im-tr.im-catrow')].map((r) => r.querySelector('.im-badge')?.textContent ?? '');
    expect(rows).toEqual(['Opgeslagen', 'Voorstel', '']);
    expect(screen.getByRole('combobox', { name: 'Categorie in Saldo voor Eten & Drinken › Boodschappen' }).textContent).toBe('Boodschappen');
    expect(screen.getByRole('combobox', { name: 'Categorie in Saldo voor Wonen › Energie, nutsvoorzieningen' }).textContent).toBe('Wonen › Energie');
    expect(api.previewImport).toHaveBeenCalledTimes(2); // the same mapping: nothing asked again
    fireEvent.click(next());

    // Check and result: the map of names and the choice per pair go with both, one batch per account.
    await screen.findByRole('button', { name: 'Importeer 28 transacties' });
    const target = { Spaarrekening: SPAAR.id, Zichtrekening: ZICHT.id };
    const choices = [
      { category: 'Eten & Drinken', subcategory: 'Boodschappen', action: 'map', categoryId: 2 },
      { category: 'Wonen', subcategory: 'Energie, nutsvoorzieningen', action: 'map', categoryId: 10 },
      { category: '', subcategory: '', action: 'skip' },
    ];
    expect(api.previewImport.mock.calls[2][1]).toEqual({ target, mapping: BILANCE.mapping, categories: choices });
    expect(screen.getByText('Dit is wat er in je Spaarrekening en Zichtrekening komt.')).toBeTruthy();
    api.importFile.mockResolvedValueOnce({
      batches: [
        { id: 7, source: 'bilance', fileName: 'bilance.csv', accountId: ZICHT.id, createdAt: '2026-11-18T20:00:00+01:00', imported: 24, present: 1, invalid: 1 },
        { id: 8, source: 'bilance', fileName: 'bilance.csv', accountId: SPAAR.id, createdAt: '2026-11-18T20:00:00+01:00', imported: 4, present: 0, invalid: 0 },
      ],
      errors: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 28 transacties' }));
    await screen.findByRole('heading', { name: '28 transacties geïmporteerd' });
    expect(api.importFile.mock.calls[0][1]).toEqual(target);
    expect(api.importFile.mock.calls[0][5]).toEqual(choices);
    expect(screen.getByText('In 2 rekeningen. Bewaard als batch 7 en 8.')).toBeTruthy();
    expect(screen.getAllByText('Bilance-export · batch 7 · vandaag').length + screen.getAllByText(/Bilance-export · batch 8/).length).toBeGreaterThan(1);
  });

  it('maps a pair by hand, a whole main category at once, and a new category, and sends those choices', async () => {
    const api = bilanceApi();
    api.previewImport.mockImplementation(async (file, o = {}) => ({
      ...BILANCE,
      fileName: file.name,
      ...(o.mapping
        ? {
            accounts: [{ name: 'Zichtrekening', rows: 30 }],
            categories: [
              { category: 'Wonen', subcategory: 'Energie, nutsvoorzieningen', rows: 3, total: -30000, saved: null, suggestion: 10 },
              { category: 'Wonen', subcategory: 'Huur, hypotheek', rows: 2, total: -200000, saved: null, suggestion: null },
              { category: 'Winkelen', subcategory: 'Overig', rows: 5, total: -9000, saved: null, suggestion: null },
            ],
          }
        : {}),
      ...(o.mapping && o.target !== undefined ? { counts: { rows: 30, new: 28, present: 1, invalid: 1, overlap: 0, categorised: 5 }, errors: [] } : {}),
    }));
    renderAt('/importeren');
    await choose(csv('bilance.csv'));
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    await screen.findByText('Naam in het bestand');
    pick(screen.getByRole('combobox', { name: 'Rekening in Saldo voor Zichtrekening' }), 'Zichtrekening');
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Koppel de categorieën' });
    const sel = (label: string) => screen.getByRole('combobox', { name: 'Categorie in Saldo voor ' + label });

    // A pair by hand: the other pair sharing the target is named as merged.
    pick(sel('Wonen › Huur, hypotheek'), 'Wonen › Energie');
    expect(screen.getByText('Samen met Wonen › Energie, nutsvoorzieningen')).toBeTruthy();
    // A new category: its name starts with the pair's own, and is sent with parent, type and icon.
    pick(sel('Winkelen › Overig'), /Nieuwe categorie/);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Webwinkels' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Tas' }));
    // The next step is blocked by an empty name.
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: ' ' } });
    expect(screen.getByText('Geef de nieuwe categorie een naam.')).toBeTruthy();
    expect(next().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Webwinkels' } });

    // Per hoofdcategorie: Wonen takes one target for both pairs.
    fireEvent.click(screen.getByRole('switch', { name: 'Per hoofdcategorie koppelen' }));
    pick(sel('Wonen'), 'Wonen');
    fireEvent.click(next());
    await screen.findByRole('button', { name: 'Importeer 28 transacties' });
    expect(document.body.textContent).toContain('5 nieuwe rijen krijgen een categorie, 23 blijven zonder categorie.');
    const sent = api.previewImport.mock.calls.at(-1)?.[1]?.categories;
    expect(sent).toEqual([
      { category: 'Wonen', subcategory: 'Energie, nutsvoorzieningen', action: 'map', categoryId: 1 },
      { category: 'Wonen', subcategory: 'Huur, hypotheek', action: 'map', categoryId: 1 },
      { category: 'Winkelen', subcategory: 'Overig', action: 'create', new: { name: 'Webwinkels', parentId: null, type: 'expense', icon: 'bag' } },
    ]);
  });

  it('reads the file again with the delimiter or encoding the user picks, and sends the settings on', async () => {
    const api = bilanceApi();
    renderAt('/importeren');
    await choose(csv('bilance.csv'));
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    pick(screen.getByRole('combobox', { name: 'Scheidingsteken' }), 'Puntkomma ( ; )');
    await waitFor(() => expect(api.previewImport).toHaveBeenCalledTimes(2));
    expect(api.previewImport.mock.calls[1][1]).toEqual({ settings: { delimiter: ';' } });
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    pick(screen.getByRole('combobox', { name: 'Decimaalteken' }), 'Punt · 1,234.56');
    await waitFor(() => expect(api.previewImport.mock.calls.at(-1)?.[1]).toEqual({ mapping: BILANCE.mapping, settings: { delimiter: ';', decimal: '.' } }));
  });

  it('suggests the first synced date as cutoff, and lists the probable duplicates side by side, skipped until included', async () => {
    const api = stubApi({ accounts: [ZICHT] });
    const streaming = { name: 'Streaming', icon: 'tv', colour: 'c5' };
    const dup = (line: number, who: string, existing: string, takes: boolean) => ({
      line, accountId: ZICHT.id, date: '2026-10-18', amount: -1199, counterparty: who, note: '', source: ['Winkelen', 'Overig'] as [string, string], category: streaming, takes,
      existing: { id: line, date: '2026-10-17', amount: -1199, counterparty: existing, communication: '', category: takes ? null : { name: 'Abonnementen', icon: 'repeat', colour: 'c5' }, imported: false },
    });
    // The answer of the server: with the cutoff the two rows are skipped by date, without it they are probable duplicates.
    api.previewImport.mockImplementation(async (file, o = {}) => ({
      ...BILANCE,
      fileName: file.name,
      ...(o.mapping ? { accounts: [{ name: 'Zichtrekening', rows: 30 }], categories: [] } : {}),
      ...(o.mapping && o.target !== undefined
        ? {
            counts: o.cutoffs
              ? { rows: 30, new: 20, present: 2, invalid: 1, afterCutoff: 7, probable: 0, categoryTaken: 0 }
              : { rows: 30, new: 25, present: 2, invalid: 1, afterCutoff: 0, probable: 2, categoryTaken: 1, categorised: 20 },
            duplicates: o.cutoffs ? { total: 0, items: [] } : { total: 2, items: [dup(3, 'SPOTIFY AB', 'Spotify', true), dup(4, 'Bakkerij', 'Bakkerij De Graankorrel', false)] },
            cutoffs: [{ accountId: ZICHT.id, suggested: '2025-11-01' }],
            errors: [],
          }
        : {}),
    }));
    renderAt('/importeren');
    await choose(csv('bilance.csv'));
    await screen.findByRole('heading', { name: 'Welk bestand importeer je?' });
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Wat staat in welke kolom?' });
    await waitFor(() => expect(next().disabled).toBe(false));
    onward();

    // The suggestion is the default: the check asked again with that date, and the rows after it are counted, not listed.
    await screen.findByRole('button', { name: 'Importeer 20 transacties' });
    expect(api.previewImport.mock.calls.at(-1)?.[1]?.cutoffs).toEqual({ [ZICHT.id]: '2025-11-01' });
    const date = screen.getByLabelText('Afkapdatum', { selector: 'input' }) as HTMLInputElement;
    expect(date.value).toBe('2025-11-01');
    expect(screen.getByText('Voorstel')).toBeTruthy();
    expect(screen.getByText('na afkapdatum').previousSibling?.textContent).toBe('7');
    expect(screen.queryByText('Waarschijnlijke dubbels')).toBeNull();

    // No cutoff: the duplicates appear, each with the file's row and the stored row; nothing is imported for them yet.
    fireEvent.click(screen.getByRole('button', { name: 'Geen afkapdatum' }));
    await screen.findByRole('button', { name: 'Importeer 25 transacties' });
    expect(api.previewImport.mock.calls.at(-1)?.[1]?.cutoffs).toBeUndefined();
    expect(date.value).toBe('');
    const rows = [...document.querySelectorAll('.im-dup')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('In het bestand')).toBeTruthy();
    expect(within(rows[0]).getByText('SPOTIFY AB')).toBeTruthy();
    expect(within(rows[0]).getByText('Al in Saldo · van de bank')).toBeTruthy();
    expect(within(rows[0]).getByText('Spotify')).toBeTruthy();
    expect(within(rows[0]).getByText('Niet gecategoriseerd')).toBeTruthy();
    expect(within(rows[0]).getByText('krijgt Streaming')).toBeTruthy();
    expect(within(rows[1]).getByText('Abonnementen')).toBeTruthy(); // its own category stays: nothing is taken over
    expect(within(rows[0]).getByRole('button', { name: 'Toch importeren' }).getAttribute('aria-pressed')).toBe('false');
    const section = screen.getByRole('heading', { name: 'Waarschijnlijke dubbels' }).closest('section') as HTMLElement;
    expect(within(section).getByText('2 overgeslagen')).toBeTruthy();
    expect(document.body.textContent).toContain('1 bestaande transactie krijgt de categorie uit het bestand');

    // Including a row imports it (without asking the server again); including all does the same for every row.
    const calls = api.previewImport.mock.calls.length;
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Toch importeren' }));
    expect(within(rows[0]).getByRole('button', { name: 'Wordt geïmporteerd' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Importeer 26 transacties' })).toBeTruthy();
    expect(within(section).getByText('1 overgeslagen')).toBeTruthy();
    expect(screen.queryByText('krijgt Streaming')).toBeNull();
    expect(document.body.textContent).not.toContain('bestaande transactie krijgt');
    fireEvent.click(screen.getByRole('button', { name: 'Alles opnemen' }));
    expect(screen.getByRole('button', { name: 'Importeer 27 transacties' })).toBeTruthy();
    expect(api.previewImport).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Importeer 27 transacties' }));
    await screen.findByRole('heading', { name: /transacties geïmporteerd/ });
    expect(api.importFile.mock.calls[0][6]).toEqual({ include: [3, 4], cutoffs: undefined });
  });
});
