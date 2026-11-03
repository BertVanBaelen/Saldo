import type { IconName } from '../components/Icon';

export type ScreenId =
  | 'start'
  | 'transacties'
  | 'overzicht'
  | 'planning'
  | 'meer'
  | 'rekeningen'
  | 'bankkoppelingen'
  | 'categorieen'
  | 'importeren'
  | 'meldingen'
  | 'instellingen';

export interface NavItem {
  id: ScreenId;
  label: string;
  to: string;
  icon: IconName;
  /** Shown in the phone tab bar. */
  tab?: boolean;
  /** Sidebar group on desktop. */
  side?: 'main' | 'beheer';
  /** The tab marked current for a sub page (phone). */
  tabParent?: ScreenId;
  stroke?: number;
}

// Main destinations (analysis 12, "Navigation"; analysis/concepts/app-shell.md).
// Meldingen sits in the Beheer group on desktop (decision 3 Nov 2026).
export const NAV: NavItem[] = [
  { id: 'start', label: 'Start', to: '/', icon: 'home', tab: true, side: 'main' },
  { id: 'transacties', label: 'Transacties', to: '/transacties', icon: 'list', tab: true, side: 'main' },
  { id: 'overzicht', label: 'Overzicht', to: '/overzicht', icon: 'chart', tab: true, side: 'main' },
  { id: 'planning', label: 'Planning', to: '/planning', icon: 'calendar', tab: true, side: 'main' },
  { id: 'meer', label: 'Meer', to: '/meer', icon: 'more', tab: true, stroke: 3 },
  { id: 'rekeningen', label: 'Rekeningen', to: '/rekeningen', icon: 'card', side: 'beheer', tabParent: 'meer' },
  { id: 'bankkoppelingen', label: 'Bankkoppelingen', to: '/bankkoppelingen', icon: 'link', side: 'beheer', tabParent: 'meer' },
  { id: 'categorieen', label: 'Categorieën', to: '/categorieen', icon: 'tag', side: 'beheer', tabParent: 'meer' },
  { id: 'importeren', label: 'Importeren', to: '/importeren', icon: 'upload', side: 'beheer', tabParent: 'meer' },
  { id: 'meldingen', label: 'Meldingen', to: '/meldingen', icon: 'bell', side: 'beheer', tabParent: 'meer' },
  { id: 'instellingen', label: 'Instellingen', to: '/instellingen', icon: 'sliders', side: 'beheer', tabParent: 'meer' },
];

export const navItem = (id: ScreenId) => NAV.find((n) => n.id === id);

/** The screen of a path: "/" → start, "/transacties" → transacties. */
export function screenOf(pathname: string): ScreenId | null {
  const seg = pathname.replace(/^\/+/, '').split('/')[0] || 'start';
  return NAV.some((n) => n.id === seg) ? (seg as ScreenId) : null;
}
