import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { installPush, KEY, KEY_BYTES } from '../test/push';
import { ME, renderRoot, stubApi } from '../test/helpers';
import { AppProvider } from './AppContext';

function server() {
  stubApi();
  return {
    pushKey: vi.spyOn(api, 'pushKey').mockResolvedValue({ key: KEY, enabled: true }),
    save: vi.spyOn(api, 'savePushSubscription').mockResolvedValue(null),
  };
}

describe('Web Push self-healing at app start', () => {
  it('tells the server about this device’s subscription once the viewer is known', async () => {
    installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const { save } = server();
    render(
      <AppProvider me={ME}>
        <p>Saldo</p>
      </AppProvider>,
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: { p256dh: 'p256dh-of-device-1', auth: 'auth-of-device-1' } });
  });

  it('runs again when the app is started again, not when it re-renders', async () => {
    installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const { save } = server();
    const app = (
      <AppProvider me={ME}>
        <p>Saldo</p>
      </AppProvider>
    );
    const view = render(app);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    view.rerender(app);
    view.unmount();
    render(app);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('does nothing in a browser without push, and does not ask for a permission', async () => {
    installPush({ noPushApis: true });
    const { pushKey, save } = server();
    render(
      <AppProvider me={ME}>
        <p>Saldo</p>
      </AppProvider>,
    );
    expect(await screen.findByText('Saldo')).toBeTruthy();
    expect(pushKey).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not run before sign-in', async () => {
    installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const { pushKey, save } = server();
    renderRoot('/inloggen');
    expect(await screen.findByRole('heading', { name: /inloggen/i })).toBeTruthy();
    expect(pushKey).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
