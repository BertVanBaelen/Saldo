// Inline stroke icons on a 24 grid, copied from the design boards. No emoji, no icon font.
// Screens may add their own: Saldo.icons.paths.myIcon = '<path d="…"></path>';
(function (S) {
  'use strict';

  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V20h14V9.5"></path>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"></path><path d="M4 6h.01M4 12h.01M4 18h.01"></path>',
    chart: '<path d="M3 21h18"></path><path d="M6 17v-6"></path><path d="M11 17V6"></path><path d="M16 17v-9"></path>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"></path>',
    card: '<rect x="3" y="6" width="18" height="14" rx="3"></rect><path d="M3 10h18M16 15h2"></path>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"></path><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"></path>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"></path><path d="M7.5 7.5h.01"></path>',
    upload: '<path d="M12 15V4"></path><path d="m7 9 5-5 5 5"></path><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"></path>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"></path><path d="M10 20a2 2 0 0 0 4 0"></path>',
    moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"></path>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect>',
    person: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    people: '<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><circle cx="17" cy="9" r="2.5"></circle><path d="M16 14.2a5 5 0 0 1 5 4.8"></path>',
    sync: '<path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 4v5h-5"></path>',
    warning: '<path d="M12 3 2 20h20L12 3Z"></path><path d="M12 10v4M12 17h.01"></path>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    chevron: '<path d="m9 6 6 6-6 6"></path>',
    back: '<path d="m15 6-6 6 6 6"></path>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"></rect><path d="M11 18.5h2"></path>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m4 7 8 6 8-6"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    close: '<path d="M6 6l12 12M18 6 6 18"></path>',
    check: '<path d="m5 12 5 5 9-10"></path>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"></path><path d="M10 17l-5-5 5-5"></path><path d="M5 12h11"></path>'
  };

  // icon('home', 22) or icon('more', 22, 3)
  function icon(name, size, stroke) {
    const s = size || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (stroke || 2) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  // The app icon "Beurs": a coin peeking from a wallet (design board Saldo-Icoon).
  function logo(size, radius) {
    const s = size || 32;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 96 96" aria-hidden="true">' +
      '<rect width="96" height="96" rx="' + (radius || 26) + '" fill="#15803D"></rect>' +
      '<circle cx="44" cy="31" r="12" fill="#FFD59E"></circle>' +
      '<rect x="18" y="36" width="60" height="40" rx="12" fill="#15803D" stroke="#FFFFFF" stroke-width="' + (s <= 40 ? 7 : 6) + '"></rect>' +
      '<rect x="58" y="48" width="23" height="16" rx="8" fill="#FFFFFF"></rect>' +
      (s > 40 ? '<circle cx="66" cy="56" r="3.5" fill="#15803D"></circle>' : '') +
      '</svg>';
  }

  S.icons = { paths, icon, logo };
  S.icon = icon;
})(window.Saldo = window.Saldo || {});
