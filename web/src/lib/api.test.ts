import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, NETWORK_MESSAGE, onUnauthorized, transactionsPath } from './api';

function respond(status: number, body: unknown, raw = false) {
  return vi.fn().mockResolvedValue(new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('answers the parsed body', async () => {
    const fetch = respond(200, { status: 'ok', version: '0.2.0-dev', demo: true });
    vi.stubGlobal('fetch', fetch);
    await expect(api.health()).resolves.toEqual({ status: 'ok', version: '0.2.0-dev', demo: true });
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('throws the server’s Dutch message with status and code', async () => {
    vi.stubGlobal('fetch', respond(400, { error: { code: 'invalid_buffer', message: 'De buffer is een bedrag in hele euro.' } }));
    const e = await api.updateAccount(1, { buffer: 12345 }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('invalid_buffer');
    expect(e.message).toBe('De buffer is een bedrag in hele euro.');
    expect(errorMessage(e)).toBe('De buffer is een bedrag in hele euro.');
  });

  it('passes on the message of a 429 from sync, with Retry-After', async () => {
    const body = { error: { code: 'rate_limited', message: 'Je hebt net gesynchroniseerd. Probeer het over 15 minuten opnieuw.' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '900' } })));
    await expect(api.sync()).rejects.toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 900, message: 'Je hebt net gesynchroniseerd. Probeer het over 15 minuten opnieuw.' });
  });

  it('uploads a CSV as multipart: no Content-Type of its own, the mapping as a JSON field', async () => {
    const fetch = respond(200, { fileName: 'export.csv' });
    vi.stubGlobal('fetch', fetch);
    const file = new File(['a;b\n1;2\n'], 'export.csv', { type: 'text/csv' });
    const mapping = {
      date: 0, valueDate: null, amount: 1, counterparty: null, counterpartyFallback: null, counterpartyIban: null, communication: null,
      note: null, category: null, subcategory: null, account: 2, accountName: null, currency: 3,
    };
    await api.previewImport(file, { target: 4, mapping });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/imports/preview');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBeUndefined();
    const body = init.body as FormData;
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('accountId')).toBe('4');
    expect(JSON.parse(body.get('mapping') as string)).toEqual(mapping);

    await api.previewImport(file);
    const first = fetch.mock.calls[1][1].body as FormData;
    expect([...first.keys()]).toEqual(['file']);

    // Accounts from a column go as a map of names, the overrides as a JSON field of their own.
    await api.previewImport(file, { target: { Zicht: 4 }, mapping, settings: { delimiter: ',', decimal: '.' } });
    const third = fetch.mock.calls[2][1].body as FormData;
    expect(third.get('accountId')).toBeNull();
    expect(JSON.parse(third.get('accountMap') as string)).toEqual({ Zicht: 4 });
    expect(JSON.parse(third.get('settings') as string)).toEqual({ delimiter: ',', decimal: '.' });
  });

  it('sends no Content-Type without a body', async () => {
    const fetch = respond(202, { started: true });
    vi.stubGlobal('fetch', fetch);
    await api.sync();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/sync');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('falls back to a Dutch message when the body has none', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>', true));
    await expect(api.accounts()).rejects.toMatchObject({ status: 502, code: 'http_502', message: 'Er ging iets mis op de server (502). Probeer het opnieuw.' });
  });

  it('turns a network failure into an offline message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'network', message: NETWORK_MESSAGE });
  });

  it('sends JSON bodies with the right method', async () => {
    const fetch = respond(200, { scope: 'gedeeld', theme: 'system' });
    vi.stubGlobal('fetch', fetch);
    await api.savePreferences({ scope: 'gedeeld' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/me/preferences');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ scope: 'gedeeld' });

    const patch = respond(200, { id: 4 });
    vi.stubGlobal('fetch', patch);
    await api.updateAccount(4, { name: 'Huishouden', colour: 'teal' });
    expect(patch.mock.calls[0][0]).toBe('/api/accounts/4');
    expect(patch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('reports a 401 as signed out, except the sign-in routes’ own 401 (a wrong code)', async () => {
    const signedOut = vi.fn();
    const off = onUnauthorized(signedOut);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_code', message: 'Deze code klopt niet.' } }), { status: 401 })));
    await expect(api.verify('ch', '12345678')).rejects.toMatchObject({ status: 401, code: 'invalid_code', message: 'Deze code klopt niet.' });
    expect(signedOut).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', respond(401, { error: { code: 'unauthorized', message: 'Je bent niet aangemeld.' } }));
    await expect(api.accounts()).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toHaveBeenCalledTimes(1);
    off();
  });

  it('builds the transactions query and leaves out empty values', () => {
    expect(transactionsPath()).toBe('/api/transactions');
    expect(transactionsPath({ scope: 'alles', q: '  ' })).toBe('/api/transactions');
    expect(transactionsPath({ scope: 'gedeeld', q: 'colruyt', uncategorised: true, limit: 50 })).toBe('/api/transactions?scope=gedeeld&q=colruyt&uncategorised=1&limit=50');
    expect(transactionsPath({ account: 4, before: 'abc==' })).toBe('/api/transactions?account=4&before=abc%3D%3D');
    expect(transactionsPath({ from: '2026-10-01', to: '2026-10-31' })).toBe('/api/transactions?from=2026-10-01&to=2026-10-31');
  });
});

describe('categorisation calls', () => {
  const tx = {
    id: 101,
    accountId: 1,
    bookingDate: '2026-11-18',
    amount: -8642,
    counterparty: 'Colruyt Laagste Prijzen',
    communication: 'Bancontact',
    status: 'booked',
    category: { id: 2, name: 'Boodschappen', colour: 'c2' },
    categoryOrigin: 'manual',
    ruleId: null,
    note: 'verjaardagscadeau',
    splits: null,
    transfer: false,
  };
  const skipped = { manual: 2, import: 0, split: 0, rule: 1 };
  const sent = (fetch: ReturnType<typeof respond>) => {
    const [url, init] = fetch.mock.calls[0];
    return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) };
  };

  it('patches the category and the note of a transaction', async () => {
    const fetch = respond(200, tx);
    vi.stubGlobal('fetch', fetch);
    await expect(api.updateTransaction(101, { categoryId: 2, note: null })).resolves.toEqual(tx);
    expect(sent(fetch)).toEqual({ url: '/api/transactions/101', method: 'PATCH', body: { categoryId: 2, note: null } });
  });

  it('reads the preview of "apply to similar" without a body', async () => {
    const preview = { counterparty: 'Colruyt Laagste Prijzen', scope: 'user', count: 14, skipped };
    const fetch = respond(200, preview);
    vi.stubGlobal('fetch', fetch);
    await expect(api.similarPreview(101)).resolves.toEqual(preview);
    expect(sent(fetch)).toEqual({ url: '/api/transactions/101/similar', method: 'GET', body: undefined });
  });

  it('applies to similar with an empty JSON body', async () => {
    const result = { transaction: tx, rule: { id: 3, categoryId: 2 }, ruleCreated: true, updated: 14, skipped };
    const fetch = respond(200, result);
    vi.stubGlobal('fetch', fetch);
    await expect(api.applySimilar(101)).resolves.toEqual(result);
    expect(sent(fetch)).toEqual({ url: '/api/transactions/101/similar', method: 'POST', body: {} });
  });

  it('puts the split parts and deletes them again, each answering the transaction', async () => {
    const parts = [
      { categoryId: 3, amount: -6492 },
      { categoryId: 1, amount: -2150 },
    ];
    const split = { ...tx, category: null, categoryOrigin: null, splits: [{ category: { id: 3, name: 'Vrije tijd', colour: 'c3' }, amount: -6492 }] };
    const put = respond(200, split);
    vi.stubGlobal('fetch', put);
    await expect(api.splitTransaction(101, parts)).resolves.toEqual(split);
    expect(sent(put)).toEqual({ url: '/api/transactions/101/split', method: 'PUT', body: { parts } });

    const del = respond(200, tx);
    vi.stubGlobal('fetch', del);
    await expect(api.unsplitTransaction(101)).resolves.toEqual(tx);
    expect(sent(del)).toEqual({ url: '/api/transactions/101/split', method: 'DELETE', body: undefined });
  });

  it('reads the category tree and the rules', async () => {
    const tree = [{ id: 1, name: 'Wonen', type: 'expense', colour: 'c1', icon: 'home', parentId: null, count: 0 }];
    const get = respond(200, tree);
    vi.stubGlobal('fetch', get);
    await expect(api.categories()).resolves.toEqual(tree);
    expect(sent(get)).toEqual({ url: '/api/categories', method: 'GET', body: undefined });

    const rules = [{ id: 3, accountId: null, priority: 0, counterparty: 'Colruyt', categoryId: 2, permission: 'edit' }];
    const list = respond(200, rules);
    vi.stubGlobal('fetch', list);
    await expect(api.rules()).resolves.toEqual(rules);
    expect(sent(list)).toEqual({ url: '/api/rules', method: 'GET', body: undefined });
  });

  const noContent = () => vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

  it('creates, patches and removes categories', async () => {
    const top = { id: 11, name: 'Huisdieren', type: 'expense', colour: 'c3', icon: null, parentId: null, count: 0 };
    const post = respond(201, top);
    vi.stubGlobal('fetch', post);
    await expect(api.createCategory({ name: 'Huisdieren', type: 'expense', colour: 'c3' })).resolves.toEqual(top);
    expect(sent(post)).toEqual({ url: '/api/categories', method: 'POST', body: { name: 'Huisdieren', type: 'expense', colour: 'c3' } });

    const patch = respond(200, top);
    vi.stubGlobal('fetch', patch);
    await api.updateCategory(11, { parentId: null, type: 'income' });
    expect(sent(patch)).toEqual({ url: '/api/categories/11', method: 'PATCH', body: { parentId: null, type: 'income' } });

    for (const moveTo of [2, 'none'] as const) {
      const del = noContent();
      vi.stubGlobal('fetch', del);
      await expect(api.deleteCategory(11, moveTo)).resolves.toBeNull();
      expect(sent(del)).toEqual({ url: '/api/categories/11?moveTo=' + moveTo, method: 'DELETE', body: undefined });
    }
  });

  it('creates, patches, previews, applies, reorders and deletes rules', async () => {
    const rule = { id: 5, accountId: null, priority: 0, counterparty: 'Colruyt', categoryId: 2, permission: 'edit' };
    const post = respond(201, rule);
    vi.stubGlobal('fetch', post);
    await expect(api.createRule({ counterparty: 'Colruyt', counterpartyExact: false, categoryId: 2 })).resolves.toEqual(rule);
    expect(sent(post)).toEqual({ url: '/api/rules', method: 'POST', body: { counterparty: 'Colruyt', counterpartyExact: false, categoryId: 2 } });

    const patch = respond(200, rule);
    vi.stubGlobal('fetch', patch);
    await api.updateRule(5, { communication: null, amountMin: 2000 });
    expect(sent(patch)).toEqual({ url: '/api/rules/5', method: 'PATCH', body: { communication: null, amountMin: 2000 } });

    const preview = { matches: 14, changes: 3, skipped };
    const pre = respond(200, preview);
    vi.stubGlobal('fetch', pre);
    await expect(api.previewRule({ counterparty: 'Colruyt', ruleId: 5 })).resolves.toEqual(preview);
    expect(sent(pre)).toEqual({ url: '/api/rules/preview', method: 'POST', body: { counterparty: 'Colruyt', ruleId: 5 } });

    const apply = respond(200, { updated: 3, skipped });
    vi.stubGlobal('fetch', apply);
    await expect(api.applyRule(5)).resolves.toEqual({ updated: 3, skipped });
    expect(sent(apply)).toEqual({ url: '/api/rules/5/apply', method: 'POST', body: undefined });

    const order = respond(200, [rule]);
    vi.stubGlobal('fetch', order);
    await expect(api.reorderRules([5, 3])).resolves.toEqual([rule]);
    expect(sent(order)).toEqual({ url: '/api/rules/order', method: 'PUT', body: { ids: [5, 3] } });

    const del = noContent();
    vi.stubGlobal('fetch', del);
    await expect(api.deleteRule(5)).resolves.toBeNull();
    expect(sent(del)).toEqual({ url: '/api/rules/5', method: 'DELETE', body: undefined });
  });

  it('reads, confirms and dismisses suggestions', async () => {
    const list = [{ counterpartyKey: 'bakkerij de graankorrel', counterparty: 'Bakkerij De Graankorrel', categoryId: 2, confidence: 92, seen: 11, open: 1 }];
    const get = respond(200, list);
    vi.stubGlobal('fetch', get);
    await expect(api.suggestions()).resolves.toEqual(list);
    expect(sent(get)).toEqual({ url: '/api/suggestions', method: 'GET', body: undefined });

    const answer = { updated: 1, rule: { id: 12, created: true, conflict: false } };
    const confirm = respond(200, answer);
    vi.stubGlobal('fetch', confirm);
    await expect(api.confirmSuggestion('bakkerij de graankorrel', 2)).resolves.toEqual(answer);
    expect(sent(confirm)).toEqual({ url: '/api/suggestions/confirm', method: 'POST', body: { counterpartyKey: 'bakkerij de graankorrel', categoryId: 2 } });

    const dismiss = noContent();
    vi.stubGlobal('fetch', dismiss);
    await expect(api.dismissSuggestion('bakkerij de graankorrel', 2)).resolves.toBeNull();
    expect(sent(dismiss)).toEqual({ url: '/api/suggestions/dismiss', method: 'POST', body: { counterpartyKey: 'bakkerij de graankorrel', categoryId: 2 } });
  });

  it('passes on the server’s message when a call is refused', async () => {
    vi.stubGlobal('fetch', respond(400, { error: { code: 'invalid', message: 'Deze transactie is gesplitst. Pas de splitsing aan of maak ze ongedaan.' } }));
    await expect(api.updateTransaction(101, { categoryId: 2 })).rejects.toMatchObject({ status: 400, message: 'Deze transactie is gesplitst. Pas de splitsing aan of maak ze ongedaan.' });

    vi.stubGlobal('fetch', respond(400, { error: { code: 'invalid', message: 'Kies eerst een categorie.' } }));
    await expect(api.similarPreview(101)).rejects.toMatchObject({ status: 400, message: 'Kies eerst een categorie.' });

    vi.stubGlobal('fetch', respond(400, { error: { code: 'invalid', message: 'Deze transactie heeft geen tegenpartij om op te vergelijken.' } }));
    await expect(api.applySimilar(101)).rejects.toMatchObject({ status: 400, message: 'Deze transactie heeft geen tegenpartij om op te vergelijken.' });

    vi.stubGlobal('fetch', respond(400, { error: { code: 'invalid', message: 'De delen tellen samen niet op tot het bedrag.' } }));
    await expect(api.splitTransaction(101, [])).rejects.toMatchObject({ status: 400, message: 'De delen tellen samen niet op tot het bedrag.' });

    vi.stubGlobal('fetch', respond(403, { error: { code: 'forbidden', message: 'Je mag deze rekening alleen lezen.' } }));
    await expect(api.unsplitTransaction(101)).rejects.toMatchObject({ status: 403, message: 'Je mag deze rekening alleen lezen.' });
  });
});
