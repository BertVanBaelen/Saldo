// Inline stroke icons on a 24 grid, ported from finance-mockup/js/icons.js (design boards). No emoji, no icon font.
import type { ReactElement } from 'react';

const paths = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  chart: <><path d="M3 21h18" /><path d="M6 17v-6" /><path d="M11 17V6" /><path d="M16 17v-9" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  card: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8L3 12Z" /><path d="M7.5 7.5h.01" /></>,
  upload: <><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  moon: <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5 4.8" /></>,
  sync: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>,
  warning: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M11 18.5h2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>,
  split: <><path d="M12 21v-7" /><path d="M12 14 6 8V4" /><path d="m12 14 6-6V4" /><path d="M3 7l3-3 3 3" /><path d="m15 7 3-3 3 3" /></>,
  transfer: <><path d="M4 8h14" /><path d="m14 4 4 4-4 4" /><path d="M20 16H6" /><path d="m10 12-4 4 4 4" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  laptop: <><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2 19h20" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  file: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9" /><path d="m16 7 3 3" /></>,
  userPlus: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M19 8v6M16 11h6" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 21h18" /></>,
  cloudOff: <><path d="M3 3l18 18" /><path d="M8.5 6.2A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2.6 7" /><path d="M17 19H7a5 5 0 0 1-1.6-9.7" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7L4 5Z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  spark: <path d="M12 4.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" />,
  // Category icons (CAT-6), same 24 grid and stroke style; home, phone, bank, shield, laptop and tag above are shared.
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.5 12h11L21 7H6" /></>,
  car: <><path d="M5 17H3v-5l2-5h14l2 5v5h-2" /><path d="M5 12h14" /><circle cx="7.5" cy="17" r="1.5" /><circle cx="16.5" cy="17" r="1.5" /></>,
  fuel: <><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M3 21h12" /><path d="M6 8h6" /><path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3" /></>,
  bus: <><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16" /><path d="M7.5 15h.01M16.5 15h.01" /><path d="M6 18v2M18 18v2" /></>,
  train: <><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 11h14" /><path d="M8.5 14.5h.01M15.5 14.5h.01" /><path d="m8 21 2-3M16 21l-2-3" /></>,
  bike: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l3.5-8H15l3 8" /><path d="M12 16 9.5 8" /></>,
  plane: <path d="M21 15.5 13 11V5a1 1 0 0 0-2 0v6l-8 4.5V18l8-2v3l-2 1.5V22l3-.8 3 .8v-1.5L13 19v-3l8 2v-2.5Z" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  water: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />,
  flame: <path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.2 2 2.5C11 9 11 6 12 3Z" />,
  wifi: <><path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16a5 5 0 0 1 6 0" /><path d="M12 19.5h.01" /></>,
  tv: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="m8 2 4 3 4-3" /><path d="M8 21h8" /></>,
  health: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" />,
  pill: <g transform="rotate(-45 12 12)"><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" /><path d="M12 8.5v7" /></g>,
  sport: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />,
  food: <><path d="M6 3v6a2 2 0 0 0 4 0V3M8 3v18" /><path d="M17 21V3c-2 1-3 4-3 7 0 2 1 3 3 3" /></>,
  coffee: <><path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" /><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v2M12 3v2" /></>,
  beer: <><path d="M5 6h11v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z" /><path d="M16 9h2.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M9 10v7M12 10v7" /></>,
  gift: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v7h14v-7" /><path d="M12 8v12" /><path d="M12 8c-1-4-6-4-5-1 .5 1.5 3 1 5 1ZM12 8c1-4 6-4 5-1-.5 1.5-3 1-5 1Z" /></>,
  school: <><path d="m2 9 10-5 10 5-10 5L2 9Z" /><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" /><path d="M22 9v6" /></>,
  book: <><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3" /></>,
  kids: <><circle cx="12" cy="12" r="9" /><path d="M9 11h.01M15 11h.01" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M12 3c-1 1.5 0 2.5 1.5 2.5" /></>,
  paw: <><circle cx="6" cy="10" r="1.8" /><circle cx="10" cy="6" r="1.8" /><circle cx="14" cy="6" r="1.8" /><circle cx="18" cy="10" r="1.8" /><path d="M12 11c-3 0-5.5 3-5.5 6 0 2 1.5 3 3 3 1 0 1.7-.5 2.5-.5s1.5.5 2.5.5c1.5 0 3-1 3-3 0-3-2.5-6-5.5-6Z" /></>,
  bag: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 11V6a3 3 0 0 1 6 0v5" /></>,
  shirt: <path d="M8 3 3 6.5l2.5 4L8 9.5V21h8V9.5l2.5 1 2.5-4L16 3a4 4 0 0 1-8 0Z" />,
  scissors: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M20 4 8 15.5M20 20 8 8.5" /></>,
  wrench: <path d="M15 4a5 5 0 0 0-4.6 7L4 17.4A2 2 0 0 0 6.6 20l6.4-6.4A5 5 0 0 0 20 9l-3 3-3-1-1-3 3-3a5 5 0 0 0-1-1Z" />,
  repeat: <><path d="M17 3l3 3-3 3" /><path d="M4 11V9a3 3 0 0 1 3-3h13" /><path d="m7 21-3-3 3-3" /><path d="M20 13v2a3 3 0 0 1-3 3H4" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10V8a3 3 0 0 1 3-3h10" /><path d="M16 14h2" /></>,
  salary: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  refund: <><path d="M4 12a8 8 0 1 1 2.34 5.66" /><path d="M4 19v-5h5" /><path d="M12 8.5v7" /></>,
  piggy: <><ellipse cx="11.5" cy="13" rx="7.5" ry="5.5" /><path d="M8 18v2.5M15 18v2.5" /><path d="M19 12h2v2.5h-2" /><path d="M9 8 8 4.5 12 7" /><path d="M15 11.5h.01M10 9h3" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11Z" />,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  gamepad: <><path d="M7 7h10a5 5 0 0 1 5 5v1a3 3 0 0 1-5.4 1.8L15.5 14h-7l-1.1.8A3 3 0 0 1 2 13v-1a5 5 0 0 1 5-5Z" /><path d="M7 10v3M5.5 11.5h3" /><path d="M16 10.5h.01M18 12.5h.01" /></>,
  camera: <><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" /><circle cx="12" cy="13" r="3.5" /></>,
  tree: <><path d="M12 3 6 10h3l-4 7h14l-4-7h3L12 3Z" /><path d="M12 17v4" /></>,
  ticket: <><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" /><path d="M14 7v1.5M14 11.25v1.5M14 15.5V17" /></>,
  hotel: <><path d="M3 19V6M3 15h18v4M21 15v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11.5" r="1.8" /></>,
  tax: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>,
  dots: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
}

/** <Icon name="home" size={22} /> or <Icon name="more" size={22} stroke={3} /> */
export function Icon({ name, size = 20, stroke = 2, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

/** The app icon "Beurs": a coin peeking from a wallet (design board Saldo-Icoon). */
export function Logo({ size = 32, radius = 26 }: { size?: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <rect width="96" height="96" rx={radius} fill="#15803D" />
      <circle cx="44" cy="31" r="12" fill="#FFD59E" />
      <rect x="18" y="36" width="60" height="40" rx="12" fill="#15803D" stroke="#FFFFFF" strokeWidth={size <= 40 ? 7 : 6} />
      <rect x="58" y="48" width="23" height="16" rx="8" fill="#FFFFFF" />
      {size > 40 && <circle cx="66" cy="56" r="3.5" fill="#15803D" />}
    </svg>
  );
}
