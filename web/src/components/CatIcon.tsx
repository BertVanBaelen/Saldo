// A category's emoji: in a round tile tinted by the category colour (CatIcon), or bare inside a chip or tile that tints itself (CatEmoji).
import { catColours } from '../lib/categories';
import { categoryEmoji } from '../lib/emoji';
import type { CategoryColour } from '../lib/types';
import './CatIcon.css';

export function CatIcon({ icon, colour, size = 'sm', className }: { icon: string | null | undefined; colour: CategoryColour; size?: 'sm' | 'lg'; className?: string }) {
  const { bg, fg } = catColours(colour);
  return (
    <span className={'cat-ico cat-ico--' + size + (className ? ' ' + className : '')} style={{ background: bg, color: fg }} aria-hidden="true">
      {categoryEmoji(icon)}
    </span>
  );
}

export function CatEmoji({ icon, className }: { icon: string | null | undefined; className?: string }) {
  return (
    <span className={'cat-emoji' + (className ? ' ' + className : '')} aria-hidden="true">
      {categoryEmoji(icon)}
    </span>
  );
}
