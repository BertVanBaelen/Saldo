// Planning · Budget (plan 0.8-6) on the demo answer: free to spend per account with the rows that add up to it, the categories, the
// link to "Planning instellen" (0.8.1-8, where the budgets are changed) and the required contribution of the shared account.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Planning } from '../lib/planning';
import { asMember, stubApi, ZICHT } from '../test/helpers';
import { CONTRIBUTION_ITEMS, demoPlanning, renderPlanning } from '../test/planningDemo';

const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);
const card = async (name: string) => (await screen.findByRole('region', { name })) as HTMLElement;
/** "−€ 24,99" as cents. */
const cents = (s: string) => Math.round(parseFloat(s.replace(/−/g, '-').replace(/[€\s.]/g, '').replace(',', '.')) * 100);

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

describe('Planning · Budget · Aanpassen', () => {
  it('links each editable account to its budgets in Planning instellen, with the month shown when it is not the running one', async () => {
    stubApi({ planning: demoPlanning });
    const first = renderPlanning('/planning#budget');
    const zicht = await card('Zichtrekening');
    expect(within(zicht).getByRole('link', { name: 'Budgetten aanpassen: Zichtrekening' }).getAttribute('href')).toBe('/planning/instellen?rekening=1#budgetten');
    expect(within(screen.getByRole('region', { name: 'Gedeelde rekening' })).getByRole('link', { name: 'Budgetten aanpassen: Gedeelde rekening' }).getAttribute('href')).toBe('/planning/instellen?rekening=4#budgetten');
    // The category rows are plain rows now: no button opens an editor sheet.
    expect(within(zicht).queryByRole('button')).toBeNull();
    first.unmount();

    renderPlanning('/planning?maand=2027-02#budget');
    expect(within(await card('Zichtrekening')).getByRole('link', { name: 'Budgetten aanpassen: Zichtrekening' }).getAttribute('href')).toBe('/planning/instellen?rekening=1&maand=2027-02#budgetten');
  });

  it('offers no way to change the budgets of accounts the viewer may only read', async () => {
    stubApi({ planning: demoPlanning, accounts: [{ ...ZICHT, permission: 'read' }, asMember('read')] });
    renderPlanning('/planning#budget');
    const zicht = await card('Zichtrekening');
    expect(within(zicht).getByText('Vrije tijd')).toBeTruthy();
    expect(within(zicht).queryByRole('link', { name: /aanpassen/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /aanpassen/i })).toBeNull();
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

  it('lists a contributor without Saldo after the members, with their part (0.8.1-7)', async () => {
    const answer = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
      const p = demoPlanning(scope, horizon);
      // November in three: ⌈871,18 / 3⌉ = € 291 each. The contributor carries a `contributorId` and never `me`.
      const c = p.accounts[1].months[0].contribution!;
      c.members = [
        { ...c.members[0], share: 34, required: 29100 },
        { contributorId: 7, name: 'Mama', me: false, share: 33, required: 29100 },
        { ...c.members[1], share: 33, required: 29100 },
      ];
      return p;
    };
    stubApi({ planning: answer, items: CONTRIBUTION_ITEMS });
    renderPlanning('/planning#budget');
    const block = within((await card('Gedeelde rekening')).querySelector('.pl-need') as HTMLElement);
    expect(block.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Jij · 34 % · € 291', 'Partner · 33 % · € 291', 'Mama · 33 % · € 291']);
  });
});
