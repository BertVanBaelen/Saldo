// A fake server for GET and PUT /api/notifications (plan 0.9-4): the settings of the defaults table (analysis/concepts/notification.md),
// and a PUT that applies a partial patch like the real one and answers the whole state. Spies are restored after each test
// (restoreMocks), as with stubApi.
import { vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import type { NotificationPatch, NotificationSettings, NotificationType } from '../lib/types';

const type = (key: string, name: string, subline: string, group: string, dot: string, push: boolean, email: boolean, emailLocked = false): NotificationType => ({
  key,
  name,
  subline,
  group,
  dot,
  push,
  email,
  emailLocked,
});

/** The defaults, in screen order. */
export const NOTIFICATIONS: NotificationSettings = {
  channels: { email: true, quietHours: true },
  lookahead: 3,
  groups: [
    { id: 'planning', label: 'Planning' },
    { id: 'bank', label: 'Bank' },
    { id: 'gedeeld', label: 'Gedeeld' },
    { id: 'transacties', label: 'Transacties' },
    { id: 'overzicht', label: 'Overzicht' },
    { id: 'beveiliging', label: 'Beveiliging' },
  ],
  types: [
    type('rood', 'Rekening staat rood', 'Als een rekening in de planning onder € 0 zakt', 'planning', 'neg', true, true),
    type('buffer', 'Rekening komt in de buffer', 'Als een rekening onder haar eigen buffer zakt', 'planning', 'warn', true, false),
    type('consent', 'Koppeling verloopt', '14 en 3 dagen vooraf', 'bank', 'warn', true, true),
    type('stop', 'Synchronisatie gestopt', 'Als Saldo een rekening niet meer kan lezen', 'bank', 'neg', true, true),
    type('joined', 'Iemand sluit aan', 'Bij een gedeelde rekening waar jij beheerder bent', 'gedeeld', 'shared', true, true),
    type('invite', 'Uitnodiging voor een gedeelde rekening', 'Als een beheerder je uitnodigt', 'gedeeld', 'shared', true, true),
    type('contrib', 'Bijdrage ontbreekt', 'Als een bijdrage op de 3e nog niet binnen is', 'gedeeld', 'shared', false, false),
    type('cat', 'Te categoriseren', 'Eén keer per dag om 19:00, als er iets is', 'transacties', 'green', true, false),
    type('week', 'Weekoverzicht', 'Elke zondag om 19:00, met wat je uitgaf per categorie', 'overzicht', 'green', false, false),
    type('month', 'Maandoverzicht', 'Op de laatste dag van de maand om 19:00, met je budgetten', 'overzicht', 'green', false, false),
    type('device', 'Nieuw toestel aangemeld', 'Als iemand inlogt op een nieuw toestel', 'beveiliging', 'warn', true, true, true),
  ],
};

/** The server's side of a PUT: only the fields sent change; the e-mail of a locked type and an unknown key are refused (400). */
function applyOnServer(s: NotificationSettings, patch: NotificationPatch): NotificationSettings {
  const next = structuredClone(s);
  if (patch.channels?.email !== undefined) next.channels.email = patch.channels.email;
  if (patch.channels?.quietHours !== undefined) next.channels.quietHours = patch.channels.quietHours;
  if (patch.lookahead !== undefined) next.lookahead = patch.lookahead;
  for (const [key, choice] of Object.entries(patch.types ?? {})) {
    const t = next.types.find((x) => x.key === key);
    if (!t) throw new ApiError(400, 'invalid', 'Onbekende melding: ' + key + '.');
    if (choice.email !== undefined && t.emailLocked) throw new ApiError(400, 'invalid', 'Deze e-mail kan je niet uitzetten.');
    if (choice.push !== undefined) t.push = choice.push;
    if (choice.email !== undefined) t.email = choice.email;
  }
  return next;
}

/** Stubs `api.notifications` and `api.saveNotifications` on a copy of `initial`; `server()` is the stored state. */
export function stubNotifications(initial: NotificationSettings = NOTIFICATIONS) {
  let stored = structuredClone(initial);
  const get = vi.spyOn(api, 'notifications').mockImplementation(async () => structuredClone(stored));
  const save = vi.spyOn(api, 'saveNotifications').mockImplementation(async (patch) => {
    stored = applyOnServer(stored, patch);
    return structuredClone(stored);
  });
  return { get, save, server: () => stored };
}
