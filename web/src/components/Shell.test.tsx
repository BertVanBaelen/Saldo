import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../test/helpers';

const sidebar = () => document.querySelector('.sidebar') as HTMLElement;
const tabbar = () => document.querySelector('.tabbar') as HTMLElement;
const current = (root: HTMLElement) => Array.from(root.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent?.trim());

describe('app shell', () => {
  it('shows the sidebar groups and the five tabs, with Start current', async () => {
    stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');

    const side = within(sidebar());
    for (const label of ['Start', 'Transacties', 'Overzicht', 'Planning', 'Rekeningen', 'Bankkoppelingen', 'Categorieën', 'Importeren', 'Meldingen', 'Instellingen']) {
      expect(side.getByRole('link', { name: new RegExp('^' + label) })).toBeTruthy();
    }
    expect(side.getByText('Beheer')).toBeTruthy();
    expect(side.getByRole('link', { name: /Bert/ }).getAttribute('href')).toBe('/meer');

    const tabs = within(tabbar()).getAllByRole('link').map((a) => a.textContent);
    expect(tabs).toEqual(['Start', 'Transacties', 'Overzicht', 'Planning', 'Meer']);
    expect(current(sidebar())).toEqual(['Start']);
    expect(current(tabbar())).toEqual(['Start']);
  });

  it('shows the uncategorised count and the bank-link dot from the alerts', async () => {
    stubApi();
    renderAt('/');
    const link = within(sidebar()).getByRole('link', { name: /^Transacties/ });
    await waitFor(() => expect(link.querySelector('.side-badge')?.textContent).toBe('2'));
    const bank = within(sidebar()).getByRole('link', { name: /^Bankkoppelingen/ });
    expect(bank.querySelector('.side-dot')).toBeTruthy();
    expect(bank.querySelector('.side-dot--neg')).toBeNull();
  });

  it('navigates with the tab bar and marks Meer for a Beheer page', async () => {
    stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');

    fireEvent.click(within(tabbar()).getByRole('link', { name: 'Transacties' }));
    expect(screen.getByTestId('location').textContent).toBe('/transacties');
    expect(await screen.findByRole('heading', { level: 1, name: 'Transacties' })).toBeTruthy();
    expect(current(tabbar())).toEqual(['Transacties']);

    fireEvent.click(within(sidebar()).getByRole('link', { name: /^Rekeningen/ }));
    expect(screen.getByTestId('location').textContent).toBe('/rekeningen');
    expect(current(tabbar())).toEqual(['Meer']);
    expect(current(sidebar())).toEqual(['Rekeningen']);

    fireEvent.click(within(sidebar()).getByRole('link', { name: /^Planning/ }));
    expect(await screen.findByText('Komt in versie 0.8')).toBeTruthy();
  });

  it('filters with the scope switch and saves the choice', async () => {
    const api = stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(screen.getByText('Persoonlijke rekeningen')).toBeTruthy();

    const group = screen.getByRole('group', { name: 'Welke rekeningen' });
    const gedeeld = within(group).getByRole('button', { name: 'Gedeeld' });
    expect(gedeeld.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(gedeeld);

    expect(gedeeld.getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Alles' }).getAttribute('aria-pressed')).toBe('false');
    expect(api.savePreferences).toHaveBeenCalledWith({ scope: 'gedeeld' });
    expect(screen.getByText('Saldo nu · Gedeelde rekening')).toBeTruthy();
    expect(screen.queryByText('Persoonlijke rekeningen')).toBeNull();

    // The choice carries across screens.
    fireEvent.click(within(tabbar()).getByRole('link', { name: 'Transacties' }));
    const g2 = await screen.findByRole('group', { name: 'Welke rekeningen' });
    expect(within(g2).getByRole('button', { name: 'Gedeeld' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ scope: 'gedeeld' }), expect.anything()));
  });

  it('applies and saves the theme from Meer → Weergave', async () => {
    const api = stubApi();
    renderAt('/meer');
    fireEvent.click(await screen.findByRole('button', { name: /Weergave/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Weergave' })).getByRole('button', { name: 'Donker' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(api.savePreferences).toHaveBeenCalledWith({ theme: 'dark' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Weergave' })).getByRole('button', { name: 'Systeem' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('shows the offline banner when the connection drops', async () => {
    stubApi();
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    expect(screen.queryByText('Je bent offline.')).toBeNull();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Je bent offline.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Synchroniseren kan niet: je bent offline' }).getAttribute('aria-disabled')).toBe('true');
  });
});
