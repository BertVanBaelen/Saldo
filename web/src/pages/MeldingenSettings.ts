// The notification settings of Meldingen (plan 0.9-4): loaded once, changed optimistically and saved one request at a time.
//
// Model: `confirmed` is what the server last said; `pending` are the changes the user made that are not answered yet, each a
// partial patch in the order made. What the screen shows is always the confirmed state with the pending patches applied, so
// - a fast second tap builds on the first (even before React has drawn it: handlers read the refs),
// - a failed save drops only its own patch (the toast says why) and the control falls back, while newer taps stay,
// - an answer never overwrites a newer tap: the saves run through ONE queue, like the budgets of Planning instellen.
// Only the field that changed is sent (`{ types: { rood: { push: false } } }`), so a stale screen cannot undo another device's change.
import { useReducer, useRef } from 'react';
import { useApp } from '../app/AppContext';
import { api, errorMessage } from '../lib/api';
import type { NotificationPatch, NotificationSettings } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Pending {
  id: number;
  patch: NotificationPatch;
}

/** The settings with one change applied (what the screen shows before the server has answered). */
export function applyPatch(s: NotificationSettings, patch: NotificationPatch): NotificationSettings {
  const types = patch.types;
  return {
    ...s,
    channels: { email: patch.channels?.email ?? s.channels.email, quietHours: patch.channels?.quietHours ?? s.channels.quietHours },
    lookahead: patch.lookahead ?? s.lookahead,
    types: types
      ? s.types.map((t) => {
          const p = types[t.key];
          return p ? { ...t, push: p.push ?? t.push, email: p.email ?? t.email } : t;
        })
      : s.types,
  };
}

export interface NotificationState {
  /** The settings as shown (confirmed + pending); `undefined` while they load or when the load failed (`error`). */
  settings: NotificationSettings | undefined;
  error: string | null;
  reload: () => void;
  /** Applies the change at once and saves it after the saves before it; a failed save rolls it back and toasts the server's message. */
  change: (patch: NotificationPatch) => void;
}

export function useNotificationSettings(): NotificationState {
  const { toast } = useApp();
  const loaded = useAsync<NotificationSettings>((signal) => api.notifications(signal), []);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const confirmed = useRef<NotificationSettings | undefined>(undefined);
  const pending = useRef<Pending[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastId = useRef(0);
  confirmed.current = loaded.data;

  const shown = () => (confirmed.current ? pending.current.reduce((s, p) => applyPatch(s, p.patch), confirmed.current) : undefined);

  const change = (patch: NotificationPatch) => {
    if (!confirmed.current) return;
    const id = ++lastId.current;
    pending.current = [...pending.current, { id, patch }];
    redraw();
    queue.current = queue.current.then(async () => {
      try {
        const saved = await api.saveNotifications(patch);
        confirmed.current = saved;
        loaded.setData(saved);
      } catch (e) {
        toast(errorMessage(e));
      } finally {
        pending.current = pending.current.filter((p) => p.id !== id);
        redraw();
      }
    });
  };

  return { settings: shown(), error: loaded.error, reload: loaded.reload, change };
}
