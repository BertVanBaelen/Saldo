# 0.8-2 · Web Push

| | |
|---|---|
| Version | [0.8 Notifications](README.md) |
| Status | planned |
| Features | NOTIF-2 |
| Concepts | [notification](../../analysis/concepts/notification.md), [design-system](../../analysis/concepts/design-system.md) |
| Screens | [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | 4.9, 7 (outbound traffic) |
| Depends on | 0.2-5 (PWA) |

## Goal
Push notifications on the phone where Saldo is installed.

## Steps
1. VAPID keys generated on first start; `push_subscription` per device (endpoint, keys, device name, last used).
2. Service worker shows title, one line and the key amount (whole euros); status-bar icon from `finance-mockup/img/statusbar-icon.svg`; colour per type.
3. Clean up expired subscriptions.

## Done when
A test push arrives on an Android phone with the right icon and colour.
