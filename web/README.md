# Saldo web app

The PWA of Saldo: Vite, React 19, TypeScript (strict) and React Router. Dutch UI, light and dark, phone layout below 1024 px (tab bar) and desktop from 1024 px (sidebar). The design reference is the frozen mockup in [`../finance-mockup/`](../finance-mockup/README.md); the API contract is [`../docs/api.md`](../docs/api.md).

## Run
Start the Go server in demo mode, then the dev server:
```powershell
cd server; $env:SALDO_DEMO='1'; go run ./cmd/saldo     # http://localhost:8080
cd web; npm install; npm run dev                       # http://localhost:5180, proxies /api and /healthz to :8080
```

| Script | Does |
|---|---|
| `npm run dev` | Vite on port 5180 |
| `npm run build` | `tsc -b && vite build` into `dist/` (served by the Go server with `SALDO_WEB_DIR`) |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest with Testing Library and jsdom |
| `npm run icons` | Renders the PWA icons in `public/icons/` from `../finance-mockup/img/` with sharp (the PNGs are committed) |

## Structure
| Path | Holds |
|---|---|
| `src/styles/tokens.css`, `components.css` | Ported from the mockup: colour tokens (light, dark, `data-theme`), shell and shared components |
| `src/styles/app.css` | App additions: skeletons, error and "not built yet" cards, boot screen, password field |
| `src/lib/format.ts` | `eur`, `eur0`, Dutch dates (U+2212 minus, `€` and a space) |
| `src/lib/api.ts`, `types.ts` | Typed client for every endpoint; errors carry the server's Dutch message; a 401 sends the app to sign-in |
| `src/lib/accounts.ts` | Scope filter, account colour and icon, states, sync lines |
| `src/app/` | App state (viewer, scope, theme, toasts, sync, counts) and the navigation |
| `src/components/` | Shell (sidebar, tab bar, offline banner, toast), icons and logo, sheet, scope switch, password field and hints |
| `src/pages/<Page>.tsx`, `.css` | Start, Transacties, Rekeningen, Meer, Instellingen, Inloggen with the link pages (`/setup`, `/uitnodiging`, `/nieuw-wachtwoord`) and the pages that are not built yet |
| `sw/sw.js`, `sw-plugin.ts` | The service worker: caches the app shell and static assets, never `/api` |
| `public/` | Manifest, icons, favicon, `theme-init.js` (applies the saved theme before the first paint) |

Money is integer cents everywhere. Sums across accounts are information only; every current account is judged on its own buffer (`analysis/concepts/scope.md`).
