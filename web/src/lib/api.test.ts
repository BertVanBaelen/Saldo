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
  });
});
