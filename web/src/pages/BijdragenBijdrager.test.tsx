// Contributors without Saldo (phase 0.8.1-7): the row on Start, the section and the sheet on the account page, the shares of
// members and contributors together, and the manager's link offer with the offered member's answer.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import type { Contributions, Contributor } from '../lib/types';
import { asMember, CONTRIBUTIONS, GEDEELD, renderAt, SPAAR, stubApi, TRANSACTIONS, ZICHT } from '../test/helpers';
import { choose } from '../test/select';

const toast = () => document.querySelector('.toast')?.textContent;
const sharedCard = () => document.querySelector('.shared-card') as HTMLElement;
/** The chips of the month's row (not the one in a contributor's own row of the card). */
const chips = (box: HTMLElement) => Array.from(box.querySelectorAll('.contrib-chips .contrib-chip')).map((e) => e.textContent);
const texts = (box: HTMLElement, selector: string) => Array.from(box.querySelectorAll(selector)).map((e) => e.textContent);
const type = (box: HTMLElement, label: string, value: string) => fireEvent.change(within(box).getByLabelText(label), { target: { value } });

/** Mama on the demo's shared account: her IBAN masked as the creator and the manager get it, € 300 received of her € 291 part. */
const MAMA: Contributor = { id: 7, name: 'Mama', share: null, iban: 'BE68 •••• •••• 7034', received: 30000, confirmed: true, required: 29100, covered: true };
/** November in three (need € 872, ⌈871,18 / 3⌉ = € 291 each): every member's part is covered. */
const noMama: Contributions = {
  ...CONTRIBUTIONS,
  need: 87200,
  members: CONTRIBUTIONS.members.map((m) => ({ ...m, required: 29100, covered: true })),
};
const withMama = (mama: Partial<Contributor> = {}): Contributions => ({ ...noMama, contributors: [{ ...MAMA, ...mama }] });

describe('Start · Bijdragen · contributors without Saldo', () => {
  it('lists a contributor after the members with the same ✓ rule', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: withMama() });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓', 'Mama € 300 ontvangen ✓']);
  });

  it('says what is still needed when the contributor is below their part', async () => {
    stubApi({ accounts: [ZICHT, GEDEELD], contributions: withMama({ received: 10000, covered: false }) });
    renderAt('/');
    await screen.findByText('Bijdragen november');
    expect(chips(sharedCard())[2]).toBe('Mama € 100 · nodig € 291');
    expect(within(sharedCard()).getByText('Mama € 100 · nodig € 291').classList.contains('contrib-chip--warn')).toBe(true);
  });
});

describe('Rekening · Bijdragers zonder Saldo', () => {
  const card = () => screen.findByRole('heading', { name: 'Bijdragen' }).then((h) => h.closest('section') as HTMLElement);
  const open = async (accounts = [ZICHT, SPAAR, GEDEELD], contributions: Contributions = withMama()) => {
    const api = stubApi({ accounts, contributions, connections: [] });
    renderAt('/rekeningen/4');
    const box = await card();
    await within(box).findByText('Bijdragen november');
    return { api, box };
  };
  const dialog = async (name: string) => within(await screen.findByRole('dialog', { name }));
  /** The row of Mama opens her sheet. */
  const openMama = async (box: HTMLElement) => {
    fireEvent.click(within(box).getByRole('button', { name: /Bijdrager aanpassen: Mama/ }));
    return dialog('Bijdrager aanpassen');
  };

  it('lists the contributor with a chip like a member’s, her share and her part of the need', async () => {
    const { box } = await open();
    expect(chips(box)).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓', 'Mama € 300 ontvangen ✓']);
    const section = within(box).getByRole('heading', { name: 'Bijdragers zonder Saldo' }).closest('.rkd-sub') as HTMLElement;
    expect(texts(section, '.contrib-other-name')).toEqual(['Mama']);
    expect(section.querySelector('.contrib-other .contrib-chip')!.textContent).toBe('€ 300 ontvangen ✓');
    expect(section.querySelector('.contrib-other-share')!.textContent).toBe('33 %');
    expect(texts(box, '.contrib-need-list li')).toEqual(['Jij · nodig € 291', 'Partner · nodig € 291', 'Mama · nodig € 291']);
    // The masked IBAN is for the sheet that corrects it, not for the list.
    expect(box.textContent).not.toContain('7034');
  });

  it('sets the shares of members and contributors together under their own keys', async () => {
    const { api, box } = await open();
    const you = within(box).getByLabelText('Jouw aandeel') as HTMLInputElement;
    const partner = within(box).getByLabelText('Aandeel van Partner') as HTMLInputElement;
    const mama = within(box).getByLabelText('Aandeel van Mama') as HTMLInputElement;
    expect([you.value, partner.value, mama.value]).toEqual(['34', '33', '33']);
    expect(within(box).getByRole('status').textContent).toBe('Samen 100 %');

    fireEvent.change(you, { target: { value: '40' } });
    fireEvent.change(partner, { target: { value: '40' } });
    expect(within(box).getByRole('status').textContent).toBe('Samen 113 % · moet 100 % zijn');
    fireEvent.change(mama, { target: { value: '20' } });
    expect(within(box).getByRole('status').textContent).toBe('Samen 100 %');
    fireEvent.click(within(box).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.setContributionShares).toHaveBeenCalledWith(4, { 1: 40, 2: 40, c7: 20 }));
    await waitFor(() => expect([you.value, partner.value, mama.value]).toEqual(['40', '40', '20']));
  });

  it('adds a contributor with a name and an IBAN, says so, and never shows the typed IBAN again', async () => {
    const { api, box } = await open([ZICHT, SPAAR, GEDEELD], noMama);
    expect(within(box).getByText(/Betaalt er iemand mee die Saldo niet gebruikt/)).toBeTruthy();
    api.addContributor.mockResolvedValue(withMama());
    fireEvent.click(within(box).getByRole('button', { name: 'Bijdrager toevoegen' }));
    const sheet = await screen.findByRole('dialog', { name: 'Bijdrager toevoegen' });
    expect(within(sheet).getByText('De IBAN waarvan de bijdrage komt. Saldo gebruikt hem alleen om de betaling te herkennen; andere leden zien hem niet.')).toBeTruthy();
    expect(within(sheet).getByText(/Het aandeel stel je daarna in bij Verdeling/)).toBeTruthy();
    type(sheet, 'Naam', 'Mama');
    type(sheet, 'IBAN', 'BE68 5390 0754 7034');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.addContributor).toHaveBeenCalledWith(4, { name: 'Mama', iban: 'BE68 5390 0754 7034' }));
    await waitFor(() => expect(toast()).toBe('Mama toegevoegd als bijdrager'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chips(box)).toContain('Mama € 300 ontvangen ✓');
    // Only the masked value is ever on screen, and the shares are equal again.
    expect(document.body.textContent).not.toContain('5390');
    expect((within(box).getByLabelText('Aandeel van Mama') as HTMLInputElement).value).toBe('33');
  });

  it('checks the name and the IBAN before it asks, and shows the server’s message when the IBAN is in use', async () => {
    const { api, box } = await open([ZICHT, SPAAR, GEDEELD], noMama);
    fireEvent.click(within(box).getByRole('button', { name: 'Bijdrager toevoegen' }));
    const sheet = await screen.findByRole('dialog', { name: 'Bijdrager toevoegen' });
    const save = () => fireEvent.click(within(sheet).getByRole('button', { name: 'Opslaan' }));
    save();
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Geef een naam van 1 tot 60 tekens.');
    expect(within(sheet).getByLabelText('Naam').getAttribute('aria-invalid')).toBe('true');
    type(sheet, 'Naam', 'Mama');
    save();
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Vul de IBAN in waarvan de bijdrage komt.');
    expect(api.addContributor).not.toHaveBeenCalled();

    api.addContributor.mockRejectedValue(new ApiError(409, 'conflict', 'Deze IBAN kan je hier niet gebruiken.'));
    type(sheet, 'IBAN', 'BE68 5390 0754 7034');
    save();
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe('Deze IBAN kan je hier niet gebruiken.'));
    expect(screen.getByRole('dialog', { name: 'Bijdrager toevoegen' })).toBeTruthy();
    expect(toast()).toBeUndefined();
  });

  it('changes only what changed: the name, and an IBAN only when one is typed; the stored IBAN is a hint, never a value', async () => {
    const { api, box } = await open();
    let sheet = await openMama(box);
    expect((sheet.getByLabelText('Naam') as HTMLInputElement).value).toBe('Mama');
    expect((sheet.getByLabelText('IBAN') as HTMLInputElement).value).toBe('');
    expect(sheet.getByText('Nu: BE68 •••• •••• 7034. Laat leeg om de IBAN te houden. Een nieuwe IBAN vervangt de oude.')).toBeTruthy();
    // Nothing changed: it closes without a request.
    fireEvent.click(sheet.getByRole('button', { name: 'Opslaan' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.updateContributor).not.toHaveBeenCalled();

    sheet = await openMama(box);
    type(screen.getByRole('dialog'), 'Naam', 'Oma');
    fireEvent.click(sheet.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateContributor).toHaveBeenCalledWith(4, 7, { name: 'Oma' }));
    await waitFor(() => expect(toast()).toBe('Bijdrager opgeslagen'));

    sheet = await openMama(box);
    type(screen.getByRole('dialog'), 'IBAN', 'BE47 0001 2345 6789');
    fireEvent.click(sheet.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateContributor).toHaveBeenLastCalledWith(4, 7, { iban: 'BE47 0001 2345 6789' }));
  });

  it('shows no IBAN hint to an editor who neither added the contributor nor manages the account', async () => {
    const { box } = await open([ZICHT, SPAAR, asMember('edit')], withMama({ iban: undefined }));
    const sheet = await openMama(box);
    expect(screen.getByRole('dialog').textContent).not.toContain('Nu:');
    expect(sheet.getByText('Laat leeg om de IBAN te houden. Een nieuwe IBAN vervangt de oude.')).toBeTruthy();
    // Linking is the manager's.
    expect(sheet.queryByRole('group', { name: 'Koppelen aan een lid' })).toBeNull();
  });

  it('removes a contributor after a confirmation in the same sheet, and the split is equal again', async () => {
    const { api, box } = await open();
    api.removeContributor.mockResolvedValue(noMama);
    let sheet = await openMama(box);
    fireEvent.click(sheet.getByRole('button', { name: 'Verwijderen' }));
    sheet = await dialog('Mama verwijderen?');
    expect(sheet.getByText(/De verdeling wordt weer gelijk voor iedereen/)).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Annuleren' }));
    sheet = await dialog('Bijdrager aanpassen');
    expect(api.removeContributor).not.toHaveBeenCalled();

    fireEvent.click(sheet.getByRole('button', { name: 'Verwijderen' }));
    fireEvent.click((await dialog('Mama verwijderen?')).getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(api.removeContributor).toHaveBeenCalledWith(4, 7));
    await waitFor(() => expect(toast()).toBe('Mama verwijderd'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chips(box)).toEqual(['Jij € 450 ontvangen ✓', 'Partner € 450 ontvangen ✓']);
    expect([(within(box).getByLabelText('Jouw aandeel') as HTMLInputElement).value, (within(box).getByLabelText('Aandeel van Partner') as HTMLInputElement).value]).toEqual(['50', '50']);
  });

  it('lets the manager offer to link a contributor to a member, and take the offer back', async () => {
    const { api, box } = await open();
    api.offerContributorLink.mockResolvedValue(withMama({ linkUserId: 2 }));
    const sheet = await openMama(box);
    const group = within(sheet.getByRole('group', { name: 'Koppelen aan een lid' }));
    const send = group.getByRole('button', { name: 'Koppelen voorstellen' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    choose(group.getByRole('combobox', { name: 'Is dit …' }), 'Partner');
    fireEvent.click(send);
    await waitFor(() => expect(api.offerContributorLink).toHaveBeenCalledWith(4, 7, 2));
    // The sheet stays open and shows the offer; so does the list.
    await sheet.findByText(/Voorgesteld aan Partner/);
    expect(within(box).getByText('Koppeling voorgesteld aan Partner')).toBeTruthy();

    api.offerContributorLink.mockResolvedValue(withMama());
    fireEvent.click(sheet.getByRole('button', { name: 'Voorstel intrekken' }));
    await waitFor(() => expect(api.offerContributorLink).toHaveBeenLastCalledWith(4, 7, null));
    await sheet.findByRole('button', { name: 'Koppelen voorstellen' });
  });

  const OFFER: Contributions = { ...noMama, linkOffers: [{ contributorId: 7, name: 'Mama', iban: 'BE68 •••• •••• 7034' }] };

  it('asks the offered member whether the IBAN is theirs, and a yes makes it their sender', async () => {
    const { api, box } = await open([ZICHT, SPAAR, asMember('edit')], OFFER);
    const offer = within(within(box).getByRole('group', { name: /stond als bijdrager/ }));
    expect(offer.getByText(/stond als bijdrager met rekening/).textContent).toBe('Mama stond als bijdrager met rekening BE68 •••• •••• 7034. Is dat jouw rekening?');
    api.answerContributorLink.mockResolvedValue({ ...noMama, mySenders: [...noMama.mySenders, { id: 9, iban: 'BE68 •••• •••• 7034' }] });
    fireEvent.click(offer.getByRole('button', { name: 'Ja, dat ben ik' }));
    await waitFor(() => expect(api.answerContributorLink).toHaveBeenCalledWith(4, 7, true));
    await waitFor(() => expect(toast()).toBe('Opgeslagen: deze rekening telt voortaan als jouw bijdrage'));
    expect(within(box).queryByRole('group', { name: /stond als bijdrager/ })).toBeNull();
    expect(within(box).getAllByText('BE68 •••• •••• 7034', { selector: '.contrib-iban' })).toHaveLength(1);
  });

  it('moves nothing after a no', async () => {
    const { api, box } = await open([ZICHT, SPAAR, asMember('edit')], OFFER);
    api.answerContributorLink.mockResolvedValue(noMama);
    fireEvent.click(within(box).getByRole('button', { name: 'Nee' }));
    await waitFor(() => expect(api.answerContributorLink).toHaveBeenCalledWith(4, 7, false));
    await waitFor(() => expect(toast()).toBe('Oké, er verandert niets'));
    expect(within(box).queryByRole('group', { name: /stond als bijdrager/ })).toBeNull();
  });

  it('gives a read-only member the list without a way to add or change, and the offer without its answer buttons', async () => {
    const { box } = await open([ZICHT, SPAAR, asMember('read')], { ...withMama(), linkOffers: OFFER.linkOffers });
    expect(texts(box, '.contrib-other-name')).toEqual(['Mama']);
    expect(within(box).queryByRole('button', { name: 'Bijdrager toevoegen' })).toBeNull();
    expect(within(box).queryByRole('button', { name: /Bijdrager aanpassen/ })).toBeNull();
    // The documented limit: the offer is there to read, and a read-only member cannot answer it.
    expect(within(box).getByText(/stond als bijdrager met rekening/)).toBeTruthy();
    expect(within(box).queryByRole('button', { name: 'Ja, dat ben ik' })).toBeNull();
  });

  it('shows Bijdragen with a contributor on an account with one member', async () => {
    const solo = { ...GEDEELD, members: [GEDEELD.members[0]] };
    const alone: Contributions = { month: '2026-11', mySenders: [], members: [{ ...noMama.members[0], required: 43600 }], need: 87200, contributors: [{ ...MAMA, required: 43600 }] };
    const { box } = await open([ZICHT, SPAAR, solo], alone);
    expect(chips(box)).toEqual(['Jij € 450 ontvangen ✓', 'Mama € 300 ontvangen ✓']);
    expect([(within(box).getByLabelText('Jouw aandeel') as HTMLInputElement).value, (within(box).getByLabelText('Aandeel van Mama') as HTMLInputElement).value]).toEqual(['50', '50']);
  });

  it('labels a recent row of the contributor’s IBAN "Bijdrage van Mama"', async () => {
    const incoming = { ...TRANSACTIONS[1], id: 118, amount: 30000, counterparty: 'M. Peeters', contribution: { name: 'Mama', me: false, contributorId: 7 } };
    stubApi({ accounts: [ZICHT, SPAAR, GEDEELD], contributions: withMama(), connections: [], transactions: [incoming, TRANSACTIONS[1]] });
    renderAt('/rekeningen/4');
    const recent = (await screen.findByRole('heading', { name: 'Recente transacties' })).closest('section') as HTMLElement;
    await within(recent).findByText('M. Peeters');
    expect(within(recent).getAllByText('Bijdrage van Mama')).toHaveLength(1);
  });
});
