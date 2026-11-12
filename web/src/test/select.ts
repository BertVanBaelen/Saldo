import { fireEvent, within } from '@testing-library/react';

/** Opens a Select (the combobox button) and picks the option with this accessible name. */
export function choose(trigger: HTMLElement, option: string | RegExp): void {
  fireEvent.click(trigger);
  // The list is portalled onto <body>, outside any within(dialog), so find it through aria-controls.
  const list = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  if (!list) throw new Error('choose(): the select did not open (disabled, or not a Select trigger?)');
  const hit = within(list).queryByRole('option', { name: option });
  if (!hit) throw new Error(`choose(): no option named ${option} in this select`);
  fireEvent.click(hit);
}
