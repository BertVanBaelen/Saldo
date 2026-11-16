// Bijdragen (phase 0.6-5): the contribution row on Start and in the shared hero, and the card on the account page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import type { ContributionMember, Contributions } from '../lib/types';
import { asMember, CONTRIBUTIONS, GEDEELD, renderAt, SPAAR, stubApi, TRANSACTIONS, ZICHT } from '../test/helpers';
import { choose } from '../test/select';
import { equalShares } from './Bijdragen';

const toast = () => document.querySelector('.toast')?.textContent;
const hero = () => document.querySelector('.hero') as HTMLElement;
const sharedCard = () => document.querySelector('.shared-card') as HTMLElement;
/** The text of every chip in a container, in order. */
const chips = (box: HTMLElement) => Array.from(box.querySelectorAll('.contrib-chip')).map((e) => e.textContent);

/** CONTRIBUTIONS with another state for Bert (me) and Partner. */
const members = (me: Partial<ContributionMember>, partner: Partial<ContributionMember> = {}): Contributions => ({
  ...CONTRIBUTIONS,
  members: [
    { ...CONTRIBUTIONS.members[0], ...me },
    { ...CONTRIBUTIONS.members[1], ...partner },
  ],
});

describe('Bijdragen · equal shares', () => {
  it('adds up to 100 for any number of members', () => {
    expect(equalShares(1)).toEqual([100]);
    expect(equalShares(2)).toEqual([50, 50]);
    expect(equalShares(3)).toEqual([34, 33, 33]);
    for (const n of [4, 6, 7, 9]) expect(equalShares(n).reduce((s, x) => s + x, 0)).toBe(100);
  });
});

describe('Start · Bijdragen', () => {
  it('shows "Bijdragen november" in the shared card with what each member sent, and never says paid', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: CONTRIBUTIONS });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']);
    expect(within(sharedCard()).getByRole('list', { name: 'Bijdragen november' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/betaald|volledig/i);
  });

  it('asks for the contributions of the shared account once and shows the row in the hero and the card', async () => {
    const api = stubApi({ accounts: [ZICHT, GEDEELD], contributions: CONTRIBUTIONS });
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    fireEvent.click(screen.getByRole('button', { name: 'Gedeeld' }));
    await screen.findByText('Saldo nu · Gedeelde rekening');
    await waitFor(() => expect(chips(hero())).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']));
    expect(chips(sharedCard())).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']);
    expect(api.contributions).toHaveBeenCalledTimes(1);
    expect(api.contributions).toHaveBeenCalledWith(4, undefined, expect.anything());
  });

  it('says "nog niet ingesteld" for a member without a sender, as plain text for the partner', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: members({}, { senders: 0, received: 0, confirmed: false }) });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij € 450 ontvangen ✓', 'Partner · nog niet ingesteld']);
    expect(within(sharedCard()).queryByRole('link', { name: /nog niet ingesteld/ })).toBeNull();
  });

  it('leads you to the account page where your own claim is made', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: members({ senders: 0, received: 0, confirmed: false }) });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij · nog niet ingesteld', 'Partner € 450 ontvangen ✓']);
    expect(within(sharedCard()).getByRole('link', { name: 'Jij · nog niet ingesteld' }).getAttribute('href')).toBe('/rekeningen/4');
  });

  it('gives a read-only member no link to claim on, as the account page offers none', async () => {
    stubApi({ accounts: [ZICHT, asMember('read')], contributions: members({ senders: 0, received: 0, confirmed: false }) });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij · nog niet ingesteld', 'Partner € 450 ontvangen ✓']);
    expect(within(sharedCard()).queryByRole('link', { name: /nog niet ingesteld/ })).toBeNull();
  });

  it('says nothing was received this month when a member has a sender but no money came in', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: members({ received: 0, confirmed: false }, { received: 0, confirmed: false }) });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij · nog niets ontvangen deze maand', 'Partner · nog niets ontvangen deze maand']);
    expect(document.body.textContent).not.toMatch(/betaald|volledig/i);
  });

  it('names the month from the answer', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: { ...CONTRIBUTIONS, month: '2026-12' } });
    renderAt('/');
    expect(await screen.findByText('Bijdragen december')).toBeTruthy();
  });

  it('shows no row for a personal answer, while loading, or when the request fails, and Start keeps working', async () => {
    // A personal answer (the default stub): no row.
    stubApi({ accounts: [ZICHT, GEDEELD] });
    const first = renderAt('/');
    await screen.findByText('Gedeelde rekening', { selector: '.row-name' });
    expect(screen.queryByText(/^Bijdragen /)).toBeNull();
    first.unmount();

    // Still loading: the account row is there, the contributions are not.
    const api = stubApi({ accounts: [ZICHT, GEDEELD] });
    api.contributions.mockImplementation(() => new Promise(() => undefined));
    const second = renderAt('/');
    await screen.findByText('Gedeelde rekening', { selector: '.row-name' });
    expect(screen.queryByText(/^Bijdragen /)).toBeNull();
    second.unmount();

    // A failure is quiet: no alert, no error card.
    const failing = stubApi({ accounts: [ZICHT, GEDEELD] });
    failing.contributions.mockRejectedValue(new ApiError(500, 'internal', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    renderAt('/');
    await screen.findByText('Gedeelde rekening', { selector: '.row-name' });
    await waitFor(() => expect(failing.contributions).toHaveBeenCalled());
    expect(screen.queryByText(/^Bijdragen /)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Laden lukt niet')).toBeNull();
  });
});

describe('Rekening · Bijdragen', () => {
  const card = () => screen.findByRole('heading', { name: 'Bijdragen' }).then((h) => h.closest('section') as HTMLElement);
  const open = async (accounts = [ZICHT, SPAAR, GEDEELD], contributions: Contributions = CONTRIBUTIONS) => {
    const api = stubApi({ accounts, contributions, connections: [] });
    renderAt('/rekeningen/4');
    const box = await card();
    await within(box).findByText('Bijdragen november');
    return { api, box };
  };

  it('shows the month’s chips, your declared sender and the explanation', async () => {
    const { box } = await open();
    expect(within(box).getByText('Wat er in november binnenkwam')).toBeTruthy();
    expect(chips(box)).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']);
    expect(within(box).getByText('BE68 •••• •••• 4821', { selector: '.contrib-iban' })).toBeTruthy();
    expect(within(box).getByText('Kies hieronder de rekening waarmee je bijdraagt. Saldo gebruikt de rekeningen van anderen nooit.')).toBeTruthy();
    // The own chip is plain text here: you are on the page where the claim is made.
    expect(within(box).queryByRole('link')).toBeNull();
  });

  it('is not on the page of a personal account', async () => {
    stubApi({ accounts: [ZICHT, SPAAR, GEDEELD], contributions: CONTRIBUTIONS, connections: [] });
    renderAt('/rekeningen/1');
    await screen.findByRole('heading', { level: 1, name: 'Zichtrekening' });
    expect(screen.queryByRole('heading', { name: 'Bijdragen' })).toBeNull();
  });

  it('declares one of your own accounts as your sender, says so in a toast and loads the recent rows again', async () => {
    const { api, box } = await open();
    const add = within(box).getByRole('button', { name: 'Dit is mijn bijdrage' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    // Only your own accounts with an IBAN, not this one and not the one declared already.
    const trigger = within(box).getByRole('combobox', { name: 'Mijn bijdrage komt van …' });
    fireEvent.click(trigger);
    const list = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Kies een rekening', 'Spaarrekening · BE41 •••• •••• 1196']);
    fireEvent.click(within(list).getByRole('option', { name: /Spaarrekening/ }));
    expect((add as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(add);
    await waitFor(() => expect(api.addContributionSender).toHaveBeenCalledWith(4, { fromAccountId: 2 }));
    await waitFor(() => expect(toast()).toBe('Opgeslagen: deze afzender telt voortaan als jouw bijdrage'));
    // The card asks again, and so does the recent list above it (its labels follow the new sender).
    await waitFor(() => expect(api.contributions.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(api.transactions.mock.calls.filter(([q]) => q?.account === 4 && q.limit === 5).length).toBeGreaterThanOrEqual(2);
    expect((within(box).getByRole('button', { name: 'Dit is mijn bijdrage' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server’s message when the sender belongs to someone else', async () => {
    const { api, box } = await open();
    api.addContributionSender.mockRejectedValue(new ApiError(409, 'conflict', 'Deze afzender hoort al bij Partner.'));
    choose(within(box).getByRole('combobox', { name: 'Mijn bijdrage komt van …' }), /Spaarrekening/);
    fireEvent.click(within(box).getByRole('button', { name: 'Dit is mijn bijdrage' }));
    expect((await within(box).findByRole('alert')).textContent).toBe('Deze afzender hoort al bij Partner.');
    expect(toast()).toBeUndefined();
  });

  it('removes your own sender after a confirmation', async () => {
    const { api, box } = await open();
    fireEvent.click(within(box).getByRole('button', { name: /Verwijderen BE68/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Afzender verwijderen?' });
    expect(within(dialog).getByText(/tellen daarna niet meer als jouw bijdrage/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuleren' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.removeContributionSender).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByRole('button', { name: /Verwijderen BE68/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(api.removeContributionSender).toHaveBeenCalledWith(4, 3));
    await waitFor(() => expect(toast()).toBe('Afzender verwijderd'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when there is no account of yours to choose', async () => {
    const { box } = await open([GEDEELD]);
    expect(within(box).queryByRole('combobox')).toBeNull();
    expect(within(box).getByText(/Je hebt geen andere rekening met een IBAN om uit te kiezen/)).toBeTruthy();
  });

  it('lets the manager set the shares, validates that they add up to 100 and says they have no effect yet', async () => {
    const { api, box } = await open();
    const you = within(box).getByLabelText('Jouw aandeel') as HTMLInputElement;
    const partner = within(box).getByLabelText('Aandeel van Partner') as HTMLInputElement;
    expect([you.value, partner.value]).toEqual(['50', '50']);
    expect(within(box).getByText('De verdeling heeft nog geen effect: ze wordt gebruikt zodra de nodige bijdrage per maand wordt berekend.')).toBeTruthy();
    expect(within(box).getByRole('status').textContent).toBe('Samen 100 %');
    const save = within(box).getByRole('button', { name: 'Opslaan' }) as HTMLButtonElement;
    const reset = within(box).getByRole('button', { name: 'Terug naar gelijk' }) as HTMLButtonElement;
    // Nothing changed and the split is equal already: nothing to save or reset.
    expect([save.disabled, reset.disabled]).toEqual([true, true]);

    fireEvent.change(you, { target: { value: '60' } });
    expect(within(box).getByRole('status').textContent).toBe('Samen 110 % · moet 100 % zijn');
    expect(save.disabled).toBe(true);
    fireEvent.change(you, { target: { value: 'abc' } });
    expect(within(box).getByRole('status').textContent).toBe('Vul per lid een getal van 0 tot 100 in.');
    expect(you.getAttribute('aria-invalid')).toBe('true');
    expect(save.disabled).toBe(true);
    fireEvent.change(you, { target: { value: '60' } });
    fireEvent.change(partner, { target: { value: '40' } });
    expect(within(box).getByRole('status').textContent).toBe('Samen 100 %');
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(api.setContributionShares).toHaveBeenCalledWith(4, { 1: 60, 2: 40 }));
    await waitFor(() => expect(toast()).toBe('Verdeling opgeslagen'));
    // What the server answered is shown, and the manager can go back to equal.
    await waitFor(() => expect([you.value, partner.value]).toEqual(['60', '40']));
    expect(save.disabled).toBe(true);
    await waitFor(() => expect(reset.disabled).toBe(false));
  });

  it('goes back to an equal split with null shares', async () => {
    const stored = members({ share: 70 }, { share: 30 });
    const { api, box } = await open([ZICHT, SPAAR, GEDEELD], stored);
    expect((within(box).getByLabelText('Jouw aandeel') as HTMLInputElement).value).toBe('70');
    api.contributions.mockImplementation(async () => structuredClone(stored));
    fireEvent.click(within(box).getByRole('button', { name: 'Terug naar gelijk' }));
    await waitFor(() => expect(api.setContributionShares).toHaveBeenCalledWith(4, null));
    await waitFor(() => expect(toast()).toBe('Verdeling weer gelijk'));
    await waitFor(() => expect([(within(box).getByLabelText('Jouw aandeel') as HTMLInputElement).value, (within(box).getByLabelText('Aandeel van Partner') as HTMLInputElement).value]).toEqual(['50', '50']));
  });

  it('only discards what was typed when the split is equal already', async () => {
    const { api, box } = await open();
    const you = within(box).getByLabelText('Jouw aandeel') as HTMLInputElement;
    fireEvent.change(you, { target: { value: '80' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Terug naar gelijk' }));
    await waitFor(() => expect(you.value).toBe('50'));
    expect(api.setContributionShares).not.toHaveBeenCalled();
  });

  it('shows a plain member their own claim and the split as text, without the manager’s controls', async () => {
    const { api, box } = await open([ZICHT, SPAAR, asMember('edit')], members({ share: 60 }, { share: 40 }));
    expect(within(box).queryByLabelText('Jouw aandeel')).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Terug naar gelijk' })).toBeNull();
    expect(within(box).getByText('60 %')).toBeTruthy();
    expect(within(box).getByText('40 %')).toBeTruthy();
    expect(within(box).getByText('Alleen de beheerder past de verdeling aan. Standaard delen alle leden gelijk.')).toBeTruthy();
    // The member's own claim stays possible: edit permission.
    expect(within(box).getByRole('button', { name: /Verwijderen BE68/ })).toBeTruthy();
    expect(within(box).getByRole('combobox', { name: 'Mijn bijdrage komt van …' })).toBeTruthy();
    expect(api.setContributionShares).not.toHaveBeenCalled();
  });

  it('is read-only for a member who may only read', async () => {
    const { box } = await open([ZICHT, SPAAR, asMember('read')]);
    expect(chips(box)).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']);
    expect(within(box).getByText('BE68 •••• •••• 4821', { selector: '.contrib-iban' })).toBeTruthy();
    expect(within(box).getByText(/Je hebt alleen leesrechten op deze rekening/)).toBeTruthy();
    expect(within(box).queryByRole('button', { name: /Verwijderen/ })).toBeNull();
    expect(within(box).queryByRole('combobox')).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Dit is mijn bijdrage' })).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Opslaan' })).toBeNull();
    expect(within(box).queryByLabelText('Jouw aandeel')).toBeNull();
  });

  it('labels a recent row that matches a member’s sender', async () => {
    const incoming = { ...TRANSACTIONS[1], id: 118, amount: 45000, counterparty: 'Partner Janssens', contribution: { name: 'Partner', me: false } };
    stubApi({ accounts: [ZICHT, SPAAR, GEDEELD], contributions: CONTRIBUTIONS, connections: [], transactions: [incoming, TRANSACTIONS[1]] });
    renderAt('/rekeningen/4');
    const recent = (await screen.findByRole('heading', { name: 'Recente transacties' })).closest('section') as HTMLElement;
    await within(recent).findByText('Partner Janssens');
    expect(within(recent).getAllByText('Bijdrage van Partner')).toHaveLength(1);
  });

  it('shows an error with a retry when the contributions do not load', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR, GEDEELD], connections: [] });
    api.contributions.mockRejectedValueOnce(new ApiError(500, 'internal', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    api.contributions.mockResolvedValue(CONTRIBUTIONS);
    renderAt('/rekeningen/4');
    const box = await card();
    expect(await within(box).findByText('Er ging iets mis op de server (500). Probeer het opnieuw.')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: /Opnieuw proberen/ }));
    expect(await within(box).findByText('Bijdragen november')).toBeTruthy();
  });
});
