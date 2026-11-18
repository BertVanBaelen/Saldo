// Joins class names and drops the falsy ones. Stands in for Untitled UI's `cx` (tailwind-merge): the controls of
// web/src/ui/ add a caller's `className` after their own, so no merge library is needed (phase 0.8-5a).
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
