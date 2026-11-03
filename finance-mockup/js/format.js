// Money and date formatting, Dutch (Belgium). Amounts are integer cents.
// See analysis/concepts/money-and-format.md.
(function (S) {
  'use strict';

  const MINUS = '−';
  const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const DAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const toDate = (d) => (d instanceof Date ? d : new Date(d + 'T12:00:00'));

  S.fmt = {
    MINUS,
    MONTHS,
    MONTHS_SHORT,
    DAYS,
    DAYS_SHORT,
    cap,

    // € 1.968,82 · −€ 86,42 · +€ 2.850,00 (signed)
    eur(cents, signed) {
      const neg = cents < 0;
      const a = Math.abs(Math.round(cents));
      const sign = neg ? MINUS : (signed && cents > 0 ? '+' : '');
      return sign + '€ ' + thousands(Math.floor(a / 100)) + ',' + String(a % 100).padStart(2, '0');
    },

    // € 1.969 · −€ 1.033 · +€ 365 (signed), for charts and summaries
    eur0(cents, signed) {
      const neg = cents < 0;
      const sign = neg ? MINUS : (signed && cents > 0 ? '+' : '');
      return sign + '€ ' + thousands(Math.round(Math.abs(cents) / 100));
    },

    // "Woensdag 18 november"
    dateLong(d) {
      const x = toDate(d);
      return cap(DAYS[x.getDay()]) + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()];
    },

    // "2 nov"
    dateShort(d) {
      const x = toDate(d);
      return x.getDate() + ' ' + MONTHS_SHORT[x.getMonth()];
    },

    // "vandaag", "gisteren" or "2 nov", relative to the demo date
    dateRelative(d, today) {
      const x = toDate(d);
      const t = toDate(today || S.data.today);
      const days = Math.round((t - x) / 86400000);
      if (days === 0) return 'vandaag';
      if (days === 1) return 'gisteren';
      return S.fmt.dateShort(x);
    },

    esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
  };
})(window.Saldo = window.Saldo || {});
