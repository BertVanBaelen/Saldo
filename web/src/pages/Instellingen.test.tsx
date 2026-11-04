import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import type { Me } from '../lib/types';
import { EB_OFF, EB_ON, ME, renderAt, stubApi } from '../test/helpers';

const content = () => document.getElementById('in-content') as HTMLElement;
const nav = () => screen.getByRole('navigation', { name: 'Instellingen' });
const toast = () => document.querySelector('.toast')?.textContent;

describe('Instellingen · Toestellen', () => {
  it('lists the devices with this one first and signs one out after confirming', async () => {
    const stub = stubApi();
    const out = vi.spyOn(api, 'signOutDevice').mockResolvedValue(null);
    renderAt('/instellingen/toestellen');

    const rows = await within(content()).findAllByText(/^(Safari|Firefox|Chrome) op/);
    expect(rows.map((r) => r.textContent)).toEqual(['Safari op iPhone', 'Chrome op Windows', 'Firefox op Ubuntu']);
    const mine = rows[0].closest('.in-device') as HTMLElement;
    expect(within(mine).getByText('Dit toestel')).toBeTruthy();
    expect(within(mine).getByText('Toegevoegd op 3 juni 2026')).toBeTruthy();
    expect(within(mine).getByText('Nu in gebruik')).toBeTruthy();
    expect(within(rows[1].closest('.in-device') as HTMLElement).getByText('Laatst gebruikt gisteren 07:41')).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: /Toestellen/ }).textContent).toContain('3');

    fireEvent.click(screen.getByRole('button', { name: 'Firefox op Ubuntu afmelden' }));
    const sheet = screen.getByRole('dialog', { name: 'Firefox op Ubuntu afmelden?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Afmelden' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(out).toHaveBeenCalledWith(5);
    expect(within(content()).queryByText('Firefox op Ubuntu')).toBeNull();
    expect(toast()).toBe('Firefox op Ubuntu afgemeld');
    expect(stub.devices).toHaveBeenCalledTimes(1);
  });

  it('signs out every other device', async () => {
    stubApi();
    const others = vi.spyOn(api, 'signOutOthers').mockResolvedValue(null);
    renderAt('/instellingen/toestellen');
    fireEvent.click(await screen.findByRole('button', { name: 'Overal afmelden behalve hier' }));
    const sheet = screen.getByRole('dialog', { name: 'Overal afmelden behalve hier?' });
    fireEvent.click(within(sheet).getByRole('button', { name: '2 toestellen afmelden' }));
    expect(await screen.findByText('Alleen dit toestel is aangemeld.')).toBeTruthy();
    expect(others).toHaveBeenCalled();
    expect(within(content()).getByText('Safari op iPhone')).toBeTruthy();
    expect(toast()).toBe('2 toestellen afgemeld');
  });
});

describe('Instellingen · Profiel', () => {
  it('changes the password: checks the repeat, shows the server’s message, then signs out the other devices', async () => {
    const stub = stubApi();
    const change = vi.spyOn(api, 'changePassword').mockRejectedValueOnce(new ApiError(400, 'invalid', 'Je huidige wachtwoord klopt niet.')).mockResolvedValue(null);
    renderAt('/instellingen/profiel');

    const toggle = within(content()).getByRole('button', { name: 'Wijzigen' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const current = screen.getByLabelText('Huidig wachtwoord');
    expect(document.activeElement).toBe(current);
    expect(current.getAttribute('autocomplete')).toBe('current-password');

    fireEvent.change(current, { target: { value: 'oud wachtwoord hier' } });
    fireEvent.change(screen.getByLabelText('Nieuw wachtwoord'), { target: { value: 'nieuwe zin van woorden' } });
    fireEvent.change(screen.getByLabelText('Herhaal nieuw wachtwoord'), { target: { value: 'nieuwe zin van woordenn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Wachtwoord wijzigen' }));
    expect(screen.getByRole('alert').textContent).toBe('Herhaal je nieuwe wachtwoord precies hetzelfde.');
    expect(change).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Herhaal nieuw wachtwoord'), { target: { value: 'nieuwe zin van woorden' } });
    fireEvent.click(screen.getByRole('button', { name: 'Wachtwoord wijzigen' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Je huidige wachtwoord klopt niet.');

    fireEvent.click(screen.getByRole('button', { name: 'Wachtwoord wijzigen' }));
    await waitFor(() => expect(toast()).toBe('Wachtwoord gewijzigd'));
    expect(change).toHaveBeenLastCalledWith('oud wachtwoord hier', 'nieuwe zin van woorden');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The other devices were signed out: the list is loaded again.
    await waitFor(() => expect(stub.devices).toHaveBeenCalledTimes(2));
  });

  it('saves the name and shows it in the sidebar', async () => {
    stubApi();
    const update = vi.spyOn(api, 'updateMe').mockResolvedValue({ ...ME.user, name: 'Robin', initial: 'R' });
    renderAt('/instellingen/profiel');
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: ' Robin ' } });
    fireEvent.click(within(content()).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Naam opgeslagen'));
    expect(update).toHaveBeenCalledWith('Robin');
    expect((document.querySelector('.side-user-name') as HTMLElement).textContent).toContain('Robin');
  });
});

// An invented, truncated key: the test only checks it is sent and never shown again.
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC-test-only\n-----END PRIVATE KEY-----\n';
const shown = (text: string) =>
  document.body.textContent!.includes(text) || Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).some((el) => el.value.includes(text));

describe('Instellingen · Enable Banking', () => {
  it('sets up the app: redirect URL to copy, key from a .pem file, application id; the key is never shown again', async () => {
    stubApi({ enableBanking: EB_OFF });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const save = vi.spyOn(api, 'saveEnableBanking').mockResolvedValue({ ...EB_ON, applicationId: 'app-7b0a4f' });
    renderAt('/instellingen/enable-banking');

    expect(await within(content()).findByText('Nog niet ingesteld')).toBeTruthy();
    expect(within(content()).getByText(EB_OFF.redirectUrl!)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Redirect-URL kopiëren' }));
    await waitFor(() => expect(toast()).toBe('Redirect-URL gekopieerd'));
    expect(writeText).toHaveBeenCalledWith(EB_OFF.redirectUrl);

    // Both are needed.
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan en testen' }));
    expect(screen.getByRole('alert').textContent).toBe('Kies je .pem-bestand of plak de sleutel.');
    fireEvent.change(screen.getByLabelText('Upload de privésleutel (.pem)'), { target: { files: [new File([PEM], 'saldo.pem', { type: 'application/x-pem-file' })] } });
    expect(await screen.findByText('saldo.pem')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan en testen' }));
    expect(screen.getByRole('alert').textContent).toBe('Vul je application ID in.');
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Vul het application ID in'), { target: { value: ' app-7b0a4f ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan en testen' }));
    expect(await within(content()).findByText('Ingesteld')).toBeTruthy();
    expect(save).toHaveBeenCalledWith('app-7b0a4f', PEM.trim());
    expect(within(content()).getByText('Opgeslagen · versleuteld')).toBeTruthy();
    expect(within(content()).getByText('app-7b0a4f')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Enable Banking is ingesteld/ }).getAttribute('href')).toBe('/bankkoppelingen');
    expect(toast()).toBe('Opgeslagen · verbinding werkt');
    expect(shown('BEGIN PRIVATE KEY')).toBe(false);
  });

  it('shows the server’s message when the key does not work, and keeps the form', async () => {
    stubApi({ enableBanking: EB_OFF });
    vi.spyOn(api, 'saveEnableBanking').mockRejectedValue(new ApiError(400, 'invalid', 'Enable Banking kent deze sleutel niet. Kijk het application ID na.'));
    renderAt('/instellingen/enable-banking');

    fireEvent.change(await screen.findByLabelText('Privésleutel plakken'), { target: { value: PEM } });
    fireEvent.change(screen.getByLabelText('Vul het application ID in'), { target: { value: 'app-7b0a4f' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan en testen' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enable Banking kent deze sleutel niet. Kijk het application ID na.');
    expect(within(content()).getByText('Nog niet ingesteld')).toBeTruthy();
  });

  it('shows a configured app without its key, says how to set public_url, and replaces the key', async () => {
    stubApi({ enableBanking: { ...EB_ON, redirectUrl: null } });
    const save = vi.spyOn(api, 'saveEnableBanking').mockResolvedValue({ ...EB_ON, redirectUrl: null });
    renderAt('/instellingen/enable-banking');

    expect(await within(content()).findByText('Ingesteld')).toBeTruthy();
    expect(within(content()).getByText(EB_ON.applicationId!)).toBeTruthy();
    expect(within(content()).getByText('Opgeslagen · versleuteld')).toBeTruthy();
    expect(content().textContent).toContain('Vul public_url in bij de opties van de Saldo-add-on');
    expect(screen.queryByRole('button', { name: 'Redirect-URL kopiëren' })).toBeNull();

    const replace = screen.getByRole('button', { name: 'Sleutel vervangen' });
    fireEvent.click(replace);
    expect((screen.getByLabelText('Application ID') as HTMLInputElement).value).toBe(EB_ON.applicationId);
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sleutel vervangen' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sleutel vervangen' }));
    fireEvent.change(screen.getByLabelText('Privésleutel plakken'), { target: { value: PEM } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan en testen' }));
    await waitFor(() => expect(toast()).toBe('Sleutel vervangen · verbinding werkt'));
    expect(save).toHaveBeenCalledWith(EB_ON.applicationId, PEM.trim());
    expect(shown('BEGIN PRIVATE KEY')).toBe(false);
    expect(within(nav()).getByRole('link', { name: /Enable Banking/ })).toBeTruthy();
  });
});

describe('Instellingen · Gebruikers', () => {
  it('is not there for a user who is not an admin', async () => {
    const stub = stubApi();
    const user: Me = { ...ME, user: { ...ME.user, role: 'user' } };
    renderAt('/instellingen/gebruikers', user);
    expect(await within(nav()).findByRole('link', { name: /Toestellen/ })).toBeTruthy();
    expect(within(nav()).queryByRole('link', { name: /Gebruikers/ })).toBeNull();
    expect(screen.queryByText('Gebruiker uitnodigen')).toBeNull();
    // The section falls back to Profiel.
    expect(within(content()).getByRole('heading', { level: 2, name: 'Profiel' })).toBeTruthy();
    expect(stub.users).not.toHaveBeenCalled();
  });

  it('lists users and invitations for an admin, and invites by e-mail with a role', async () => {
    stubApi();
    const invite = vi.spyOn(api, 'invite').mockResolvedValue({ id: 8, email: 'kim@example.com', role: 'admin', expiresAt: '2026-11-25T20:14:00+01:00' });
    renderAt('/instellingen/gebruikers');

    const partner = (await screen.findByText('partner@example.com')).closest('article') as HTMLElement;
    expect(within(partner).getByRole('button', { name: /Nieuwe wachtwoordlink sturen/ })).toBeTruthy();
    const sam = screen.getByText('sam@example.com').closest('article') as HTMLElement;
    expect(within(sam).getByText('Uitgenodigd als gebruiker · geldig tot 25 november 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Gebruiker uitnodigen' }));
    const sheet = screen.getByRole('dialog', { name: 'Gebruiker uitnodigen' });
    fireEvent.change(within(sheet).getByLabelText('E-mailadres'), { target: { value: 'kim@example.com' } });
    fireEvent.click(within(sheet).getByLabelText(/Beheerder/));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Uitnodiging versturen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invite).toHaveBeenCalledWith('kim@example.com', 'admin');
    expect(screen.getByText('kim@example.com')).toBeTruthy();
    expect(toast()).toBe('Uitnodiging verstuurd · 7 dagen geldig');
  });
});
