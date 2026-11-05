import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { BankLinkResult, SyncStatus } from '../lib/types';
import { CONNECTIONS, ME, renderAt, stubApi, ZICHT } from '../test/helpers';
import { SYNC_MAX_MS, SYNC_POLL_MS } from './AppContext';

const toast = () => document.querySelector('.toast')?.textContent;
const status = (running: boolean, connStatus: SyncStatus['connections'][number]['status'] = 'ok'): SyncStatus => ({
  running,
  startedAt: '2026-11-18T20:00:00+01:00',
  finishedAt: running ? null : '2026-11-18T20:00:05+01:00',
  connections: [{ id: 1, status: connStatus, lastSync: '2026-11-18T20:00:05+01:00', error: connStatus === 'failed' ? 'http_500' : null }],
});

describe('Sync now', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('starts the sync, polls GET /api/sync every 2 seconds, then reloads the screens and says so', async () => {
    const stub = stubApi();
    stub.syncStatus.mockResolvedValueOnce(status(true)).mockResolvedValueOnce(status(true)).mockResolvedValue(status(false));
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nu synchroniseren' }));
    await waitFor(() => expect(stub.syncStatus).toHaveBeenCalledTimes(1));
    expect(stub.sync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Bezig met synchroniseren' })).toBeTruthy();
    const loads = stub.connections.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(2 * SYNC_POLL_MS));
    await waitFor(() => expect(toast()).toBe('Gesynchroniseerd'));
    // Two answers "running", the third "done": then it stops.
    expect(stub.syncStatus).toHaveBeenCalledTimes(3);
    // dataVersion went up: Bankkoppelingen loads its connections again, without a reload.
    await waitFor(() => expect(stub.connections.mock.calls.length).toBeGreaterThan(loads));
    expect(await screen.findByRole('button', { name: 'Nu synchroniseren' })).toBeTruthy();
  });

  it('toasts a failed sync', async () => {
    const stub = stubApi();
    stub.syncStatus.mockResolvedValue(status(false, 'failed'));
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nu synchroniseren' }));
    await waitFor(() => expect(toast()).toBe('Synchroniseren is mislukt · bekijk Bankkoppelingen'));
  });

  it('stops polling after a few minutes', async () => {
    const stub = stubApi();
    stub.syncStatus.mockResolvedValue(status(true));
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nu synchroniseren' }));
    await waitFor(() => expect(stub.syncStatus).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(SYNC_MAX_MS + SYNC_POLL_MS));
    await waitFor(() => expect(toast()).toBe('Synchroniseren duurt langer dan verwacht. De gegevens komen vanzelf binnen.'));
    const polls = stub.syncStatus.mock.calls.length;
    expect(polls).toBeLessThanOrEqual(SYNC_MAX_MS / SYNC_POLL_MS + 2);
    await act(() => vi.advanceTimersByTimeAsync(10 * SYNC_POLL_MS));
    expect(stub.syncStatus).toHaveBeenCalledTimes(polls);
  });

  it('keeps polling through a network hiccup', async () => {
    const stub = stubApi();
    stub.syncStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status(false));
    renderAt('/bankkoppelingen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nu synchroniseren' }));
    await waitFor(() => expect(stub.syncStatus).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
    await waitFor(() => expect(toast()).toBe('Gesynchroniseerd'));
  });
});

describe('Back from the bank, the first sync', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('says it runs in the background until the poll says it is done', async () => {
    const stub = stubApi();
    stub.syncStatus.mockResolvedValueOnce(status(true)).mockResolvedValue(status(false));
    // A new account: no balance before its first sync.
    const result: BankLinkResult = {
      connection: { ...CONNECTIONS[0], status: 'stale', lastSync: null },
      accounts: [{ ...ZICHT, balance: 0, balanceDate: null, lastSync: null, syncStatus: 'stale' }],
      skipped: [],
    };
    vi.spyOn(api, 'bankCallback').mockResolvedValue(result);
    renderAt('/bankkoppelingen/terug?code=c0de&state=st4te', ME);

    expect(await screen.findByText(/De eerste synchronisatie loopt op de achtergrond/)).toBeTruthy();
    expect(screen.queryByText(/saldo/)).toBeNull();
    expect(stub.sync).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
    expect(await screen.findByText('Je transacties en je saldo zijn binnen.')).toBeTruthy();
    expect(toast()).toBe('Gesynchroniseerd');
  });
});
