// Planning · Budget (plan 0.8-6) on the demo answer: free to spend per account with the rows that add up to it, the categories, the
// budget editor and the required contribution of the shared account.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { Planning } from '../lib/planning';
import { asMember, stubApi, ZICHT } from '../test/helpers';
import { CONTRIBUTION_ITEMS, demoPlanning, renderPlanning } from '../test/planningDemo';

const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);
const card = async (name: string) => (await screen.findByRole('region', { name })) as HTMLElement;
const toast = () => screen.getByTestId('toast').textContent;
/** "−€ 24,99" as cents. */
const cents = (s: string) => Math.round(parseFloat(s.replace(/−/g, '-').replace(/[€\s.]/g, '').replace(',', '.')) * 100);
const switchOf = () => screen.getByRole('switch', { name: 'Geen budget (rekent met het gemiddelde)' }) as HTMLInputElement;
const amountField = () => screen.getByLabelText('Bedrag per maand') as HTMLInputElement;

describe('Planning · Budget', () => {
  it('shows what is free per account, with rows that add up to it, the stacked bar and the categories', async () => {
    stubApi({ planning: demoPlanning });
    renderPlanning('/planning#budget');
    const zicht = await card('Zichtrekening');

    expect(screen.getByText('Budget november 2026')).toBeTruthy();
    expect(texts(zicht, '.pl-bcard-free > span')).toEqual(['Vrij te besteden', '€ 306,85']);
    const main = Array.from(zicht.querySelectorAll('.pl-brow:not(.pl-brow--sub)'));
    expect(main.map((r) => r.querySelector('.pl-brow-text > span')!.textContent)).toEqual(['Saldo vandaag', 'Vaste kosten', 'Budgetten', 'Buffer']);
    // 196882 − 2499 − 73698 − 90000
    expect(main.reduce((s, r) => s + cents(r.querySelector('.pl-brow-amount')!.textContent!), 0)).toBe(30685);
    expect(texts(zicht, '.pl-brow--sub .pl-brow-text')).toEqual(['Vrije tijd€ 66,90 van € 350,00 al besteed', 'Vervoer€ 134,10 van € 300,00 al besteed', 'Overig€ 0,00 van € 287,98 al besteed']);
    expect(zicht.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Van € 1.969 is € 762 voorzien voor verwachte kosten, € 900 is buffer en € 307 is vrij.');
    expect(zicht.querySelector('.pl-result')!.textContent).toBe('Vrij te besteden€ 306,85');

    const gedeeld = screen.getByRole('region', { name: 'Gedeelde rekening' });
    expect(texts(gedeeld, '.pl-bcard-free > span')).toEqual(['Vrij te besteden', '€ 28,82']);
    expect(texts(gedeeld, '.pl-brow--sub .pl-brow-text')).toEqual(['Boodschappen€ 295,21 van € 550,00 al besteed', 'OverigGemiddelde € 62,47 · € 0,00 al besteed']);

    // The running month's categories, with the plan from the average marked.
    expect(texts(screen.getByRole('tabpanel'), '.pl-cat-amount')).toEqual(['€ 66,90 van € 350,00', '€ 134,10 van € 300,00', '€ 0,00 van € 287,98', '€ 295,21 van € 550,00', '€ 0,00 van € 62,47 · gemiddelde']);
  });

  it('shows "Tekort" in February and the budgets as the full amount', async () => {
    stubApi({ planning: demoPlanning });
    renderPlanning('/planning?maand=2027-02#budget');
    const zicht = await card('Zichtrekening');

    expect(screen.getByText('Budget februari 2027')).toBeTruthy();
    expect(texts(zicht, '.pl-bcard-free > span')).toEqual(['Tekort', '€ 2.034,03']);
    expect(zicht.querySelector('.pl-result')!.className).toContain('pl-result--neg');
    const main = Array.from(zicht.querySelectorAll('.pl-brow:not(.pl-brow--sub)'));
    expect(main.map((r) => r.querySelector('.pl-brow-text > span')!.textContent)).toEqual(['Startsaldo 1 februari', 'Nog te ontvangen', 'Vaste kosten', 'Eenmalig en gepland', 'Budgetten', 'Naar spaarrekening', 'Buffer']);
    expect(main.reduce((s, r) => s + cents(r.querySelector('.pl-brow-amount')!.textContent!), 0)).toBe(-203403);
    expect(texts(zicht, '.pl-brow--sub .pl-brow-note')[0]).toBe('Volledig budget € 350,00');
    expect(screen.getByRole('button', { name: 'Volgende maand' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Planning · Budget editor', () => {
  it('steps by € 10, takes the average rounded up, saves from the month shown and reloads the forecast', async () => {
    const stub = stubApi({ planning: demoPlanning });
    const save = vi.spyOn(api, 'setBudget').mockResolvedValue({ budgets: [] });
    renderPlanning('/planning#budget');
    fireEvent.click(within(await card('Gedeelde rekening')).getByRole('button', { name: /^Overig/ }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Budget Overig · Gedeelde rekening' }));
    expect(dialog.getByText('Geldt vanaf november en de maanden erna.')).toBeTruthy();
    expect(dialog.getByText(/Gemiddelde van de afgelopen 6 maanden:/).textContent).toContain('€ 62,47');
    // No budget yet: the plan is the average.
    expect(switchOf().checked).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: 'Gebruik het gemiddelde' }));
    expect(amountField().value).toBe('63');
    expect(switchOf().checked).toBe(false);

    fireEvent.click(dialog.getByRole('button', { name: '€ 10 meer' }));
    expect(amountField().value).toBe('73');
    fireEvent.click(dialog.getByRole('button', { name: '€ 10 minder' }));
    fireEvent.click(dialog.getByRole('button', { name: '€ 10 minder' }));
    expect(amountField().value).toBe('53');

    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 4, categoryId: 6, fromMonth: '2026-11', amount: 5300 }));
    await waitFor(() => expect(toast()).toBe('Budget bewaard vanaf november'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(stub.planning).toHaveBeenCalledTimes(2));
  });

  it('sends amount null for "Geen budget", from the month shown', async () => {
    stubApi({ planning: demoPlanning });
    const save = vi.spyOn(api, 'setBudget').mockResolvedValue({ budgets: [] });
    renderPlanning('/planning?maand=2026-12#budget');
    fireEvent.click(within(await card('Zichtrekening')).getByRole('button', { name: /^Vrije tijd/ }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Budget Vrije tijd · Zichtrekening' }));
    expect(amountField().value).toBe('350');
    expect(switchOf().checked).toBe(false);
    expect(dialog.queryByRole('button', { name: 'Gebruik het gemiddelde' })).toBeNull();
    fireEvent.click(switchOf());
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-12', amount: null }));
    await waitFor(() => expect(toast()).toBe('Budget bewaard vanaf december'));
  });

  it('adds a budget for a category without one, and asks for an amount first', async () => {
    stubApi({ planning: demoPlanning });
    const save = vi.spyOn(api, 'setBudget').mockResolvedValue({ budgets: [] });
    renderPlanning('/planning#budget');
    fireEvent.click(within(await card('Zichtrekening')).getByRole('button', { name: '+ Budget voor een andere categorie' }));

    // Only top expense categories that are not saving and have no budget on this account.
    const choose = within(await screen.findByRole('dialog', { name: 'Kies een categorie · Zichtrekening' }));
    for (const name of ['Wonen', 'Boodschappen', 'Abonnementen']) expect(choose.getByRole('button', { name })).toBeTruthy();
    for (const name of ['Vrije tijd', 'Vervoer', 'Overig', 'Energie', 'Loon']) expect(choose.queryByRole('button', { name })).toBeNull();
    fireEvent.click(choose.getByRole('button', { name: 'Boodschappen' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Budget Boodschappen · Zichtrekening' }));
    expect(dialog.queryByText(/Gemiddelde van de afgelopen 6 maanden/)).toBeNull();

    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Vul een bedrag in of kies Geen budget.');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(amountField(), { target: { value: '250' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 2, fromMonth: '2026-11', amount: 25000 }));
  });

  it('offers no editing on accounts the viewer may only read', async () => {
    stubApi({ planning: demoPlanning, accounts: [{ ...ZICHT, permission: 'read' }, asMember('read')] });
    renderPlanning('/planning#budget');
    const zicht = await card('Zichtrekening');
    expect(within(zicht).getByText('Vrije tijd')).toBeTruthy();
    expect(within(zicht).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Gedeelde rekening' })).queryByRole('button')).toBeNull();
  });
});

describe('Planning · required contribution', () => {
  it('shows what the shared account needs and each member’s part, only on the shared account', async () => {
    stubApi({ planning: demoPlanning, items: CONTRIBUTION_ITEMS });
    renderPlanning('/planning#budget');
    const gedeeld = within(await card('Gedeelde rekening'));
    const block = within(gedeeld.getByRole('group', { name: 'Bijdragen november' }));

    expect(block.getByText(/^Nodig:/).textContent).toBe('Nodig: € 872');
    expect(block.getByText(/^Vaste kosten en budgetten/).textContent).toBe('Vaste kosten en budgetten € 800,45 · om de buffer van € 600 te halen € 70,73');
    expect(block.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Jij · 50 % · € 436', 'Partner · 50 % · € 436']);
    // Both contribution items (€ 450 each) cover the € 872.
    await waitFor(() => expect(block.getByText('Jullie verwachte bijdragen (€ 900) dekken wat nodig is.')).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Zichtrekening' })).queryByRole('group', { name: /^Bijdragen/ })).toBeNull();
  });

  it('says nothing about the expected payments until the contribution items are there', async () => {
    const stub = stubApi({ planning: demoPlanning });
    stub.planningItems.mockImplementation(() => new Promise(() => undefined));
    renderPlanning('/planning#budget');
    const block = within((await card('Gedeelde rekening')).querySelector('.pl-need') as HTMLElement);
    expect(block.getByText(/^Nodig:/)).toBeTruthy();
    expect(screen.queryByText(/Jullie verwachte bijdragen/)).toBeNull();
  });

  it('follows the shares, leaves out the buffer part at 0 and says when the expected payments fall short', async () => {
    const answer = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
      const p = demoPlanning(scope, horizon);
      // December with a 70 / 30 split: € 801 → € 561 and € 241.
      const c = p.accounts[1].months[1].contribution!;
      c.members = [
        { ...c.members[0], share: 70, required: 56100 },
        { ...c.members[1], share: 30, required: 24100 },
      ];
      return p;
    };
    stubApi({ planning: answer, items: [CONTRIBUTION_ITEMS[0]] });
    renderPlanning('/planning?maand=2026-12#budget');
    const block = within((await card('Gedeelde rekening')).querySelector('.pl-need') as HTMLElement);

    expect(block.getByText(/^Nodig:/).textContent).toBe('Nodig: € 801');
    expect(block.getByText(/^Vaste kosten en budgetten/).textContent).toBe('Vaste kosten en budgetten € 800,45');
    expect(block.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Jij · 70 % · € 561', 'Partner · 30 % · € 241']);
    await waitFor(() => expect(block.getByText('Jullie verwachte bijdragen (€ 450) zijn € 351 minder dan nodig.')).toBeTruthy());
  });
});
