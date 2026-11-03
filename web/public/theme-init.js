// Applies the last chosen theme before the app renders, so a dark choice does not flash light.
// The saved preference on the server stays the source of truth; the app keeps this copy in sync.
try {
  var t = localStorage.getItem('saldo.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {
  /* private mode: follow the system */
}
