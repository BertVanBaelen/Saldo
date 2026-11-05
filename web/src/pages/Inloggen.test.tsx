import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, browser } from '../lib/api';
import { nextPath } from './Inloggen';
import { ME, renderAt, renderRoot, stubApi } from '../test/helpers';

const where = () => screen.getByTestId('location').textContent;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** /api/me answers 401 until the code is verified. */
function signedOut() {
  let signedIn = false;
  const me = vi.spyOn(api, 'me').mockImplementation(async () => {
    if (!signedIn) throw new ApiError(401, 'unauthorized', 'Je bent niet aangemeld.');
    return ME;
  });
  const login = vi.spyOn(api, 'login').mockResolvedValue({ challenge: 'ch-1', email: 'b•••@example.com' });
  const verify = vi.spyOn(api, 'verify').mockImplementation(async () => {
    signedIn = true;
    return { user: ME.user };
  });
  return { me, login, verify };
}

describe('Inloggen', () => {
  it('only goes back to a path inside Saldo', () => {
    expect(nextPath('/transacties?q=x')).toBe('/transacties?q=x');
    for (const v of [null, '', 'https://example.com', '//example.com', '/\\example.com', '/inloggen']) expect(nextPath(v)).toBe('/');
  });

  it('sends a signed-out visitor to sign-in, and after password and code back to the page they wanted', async () => {
    stubApi();
    const auth = signedOut();
    renderRoot('/transacties');

    expect(await screen.findByRole('heading', { level: 1, name: 'Inloggen' })).toBeTruthy();
    expect(where()).toBe('/inloggen?terug=%2Ftransacties');
    expect(screen.queryByRole('link', { name: /vergeten/i })).toBeNull();

    // Step 1: both fields are needed.
    fireEvent.click(screen.getByRole('button', { name: 'Verder' }));
    expect(screen.getByText('Vul je e-mailadres in.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('E-mailadres'));
    expect(auth.login).not.toHaveBeenCalled();

    type('E-mailadres', ' bert@example.com ');
    type('Wachtwoord', 'paard batterij nietje correct');
    fireEvent.click(screen.getByRole('button', { name: 'Verder' }));

    // Step 2: the code, sent to the masked address.
    expect(await screen.findByRole('heading', { level: 1, name: 'Vul je code in' })).toBeTruthy();
    expect(auth.login).toHaveBeenCalledWith('bert@example.com', 'paard batterij nietje correct');
    expect(screen.getByText('b•••@example.com')).toBeTruthy();
    const code = screen.getByLabelText('Code uit de e-mail') as HTMLInputElement;
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(document.activeElement).toBe(code);

    fireEvent.change(code, { target: { value: '4829-17' } });
    expect(code.value).toBe('4829 17');
    fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));
    expect(screen.getByText('Vul alle 8 cijfers in.')).toBeTruthy();
    expect(auth.verify).not.toHaveBeenCalled();

    fireEvent.change(code, { target: { value: '48291736' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));
    await waitFor(() => expect(where()).toBe('/transacties'));
    expect(auth.verify).toHaveBeenCalledWith('ch-1', '48291736');
    expect(await screen.findByRole('heading', { level: 1, name: 'Transacties' })).toBeTruthy();
  });

  it('shows the server’s Dutch messages for a wrong code and a rate limit, and asks for a new code from step one', async () => {
    const auth = signedOut();
    auth.verify.mockRejectedValueOnce(new ApiError(401, 'invalid_code', 'Deze code klopt niet. Nog 4 pogingen.'));
    renderRoot('/inloggen');

    type('E-mailadres', 'bert@example.com');
    type('Wachtwoord', 'paard batterij nietje correct');
    fireEvent.click(screen.getByRole('button', { name: 'Verder' }));
    fireEvent.change(await screen.findByLabelText('Code uit de e-mail'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Deze code klopt niet. Nog 4 pogingen.');
    expect(where()).toBe('/inloggen');
    expect((screen.getByLabelText('Code uit de e-mail') as HTMLInputElement).value).toBe('');

    // A new code: back to step one, the e-mail address kept, the password asked again.
    fireEvent.click(screen.getByRole('button', { name: 'Nieuwe code sturen' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Inloggen' })).toBeTruthy();
    expect((screen.getByLabelText('E-mailadres') as HTMLInputElement).value).toBe('bert@example.com');
    expect(document.activeElement).toBe(screen.getByLabelText('Wachtwoord'));

    auth.login.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'Te veel pogingen. Probeer het over 15 minuten opnieuw.', 900));
    type('Wachtwoord', 'paard batterij nietje correct');
    fireEvent.click(screen.getByRole('button', { name: 'Verder' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Te veel pogingen. Probeer het over 15 minuten opnieuw.');
    expect(screen.getByRole('heading', { level: 1, name: 'Inloggen' })).toBeTruthy();
  });

  it('signs this device out from Meer and starts afresh', async () => {
    stubApi();
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(null);
    const go = vi.spyOn(browser, 'go').mockImplementation(() => undefined);
    renderAt('/meer');
    fireEvent.click(await screen.findByRole('button', { name: 'Afmelden' }));
    expect(logout).toHaveBeenCalled();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
  });
});

describe('Links from e-mails and the add-on log', () => {
  it('explains a dead link instead of showing the form', async () => {
    const token = vi.spyOn(api, 'token').mockRejectedValue(new ApiError(404, 'not_found', 'Niet gevonden.'));
    renderRoot('/uitnodiging/oud-token');
    expect(await screen.findByRole('heading', { level: 1, name: 'Deze link werkt niet meer' })).toBeTruthy();
    expect(token).toHaveBeenCalledWith('oud-token', expect.anything());
    expect(screen.getByText('Ze is verlopen of al gebruikt. Een uitnodiging is 7 dagen geldig en werkt één keer.')).toBeTruthy();
    expect(screen.queryByLabelText('Wachtwoord')).toBeNull();
    expect(screen.getByRole('link', { name: 'Naar inloggen' }).getAttribute('href')).toBe('/inloggen');
  });

  it('accepts an invitation: name and password, then sign-in with a note', async () => {
    vi.spyOn(api, 'token').mockResolvedValue({ kind: 'invitation', email: 'sam@example.com', name: null });
    const redeem = vi.spyOn(api, 'redeem').mockResolvedValue(null);
    renderRoot('/uitnodiging/tok-7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Maak je account aan' })).toBeTruthy();
    const email = screen.getByLabelText('E-mailadres') as HTMLInputElement;
    expect(email.value).toBe('sam@example.com');
    expect(email.readOnly).toBe(true);
    expect(screen.getByLabelText('Wachtwoord').getAttribute('autocomplete')).toBe('new-password');

    type('Naam', 'Sam');
    type('Wachtwoord', 'kort');
    expect(screen.getByText('Minstens 12 tekens · nu 4')).toBeTruthy();
    type('Herhaal wachtwoord', 'anders');
    fireEvent.click(screen.getByRole('button', { name: 'Account aanmaken' }));
    expect(screen.getByText('De wachtwoorden zijn niet gelijk.')).toBeTruthy();
    expect(redeem).not.toHaveBeenCalled();

    // The server judges the password.
    redeem.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Kies een wachtwoord van minstens 12 tekens.'));
    type('Herhaal wachtwoord', 'kort');
    fireEvent.click(screen.getByRole('button', { name: 'Account aanmaken' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Kies een wachtwoord van minstens 12 tekens.');

    type('Wachtwoord', 'zon zee zand en duinen');
    type('Herhaal wachtwoord', 'zon zee zand en duinen');
    fireEvent.click(screen.getByRole('button', { name: 'Account aanmaken' }));
    await waitFor(() => expect(where()).toBe('/inloggen'));
    expect(redeem).toHaveBeenLastCalledWith({ token: 'tok-7', name: 'Sam', password: 'zon zee zand en duinen' });
    expect(screen.getByText('Je account is klaar. Log nu in met je e-mailadres en wachtwoord.')).toBeTruthy();
    expect((screen.getByLabelText('E-mailadres') as HTMLInputElement).value).toBe('sam@example.com');
  });
});
