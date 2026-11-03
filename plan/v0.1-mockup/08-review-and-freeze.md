# 0.1-8 · Freeze the mockup

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Size | S |
| Features | UI-5 |
| Concepts | [scope](../../analysis/concepts/scope.md), [demo-data](../../analysis/concepts/demo-data.md), [design-system](../../analysis/concepts/design-system.md) |
| Screens | all |
| Depends on | [0.1-7](07-missing-designs.md) |

## Goal
Keep the mockup as the design reference for the React app, without further work in plain HTML/JS.

## Steps
1. Freeze `finance-mockup/` as it is (decision "Build the real app", 3 Nov 2026). It is no longer extended; fixes go into the React app.
2. The tokens and shared components of `css/tokens.css` and `css/components.css` are the starting point of the web app (0.2-3); screen-local styles are promoted while porting each screen.
3. The review with Partner happens on the real app instead: every screen phase ends with a short walk-through on her iPhone and on a desktop.

## Done when
The mockup is frozen and the web app takes over. ✔