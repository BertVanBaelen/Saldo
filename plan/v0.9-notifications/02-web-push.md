# 0.9-2 · Web Push on Android and iPhone

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | planned |
| Size | M |
| Features | NOTIF-2 |
| Concepts | [notification](../../analysis/concepts/notification.md), [design-system](../../analysis/concepts/design-system.md) |
| Screens | [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | 4.9, 7 (outbound traffic), risk 19 |
| Depends on | [0.2-3](../v0.2-foundation/03-web-app-shell.md) (PWA) |

## Goal
Push notifications on both phones where Saldo is installed.

## Steps
1. VAPID keys generated on first start; `push_subscription` per device (endpoint, keys, platform, last used).
2. Service worker shows title, one line and the key amount (whole euros); Android: status-bar icon from `finance-mockup/img/statusbar-icon.svg`, colour per type, the expandable chart; iPhone: title and line only, app icon.
3. iPhone: explain "Zet Saldo op je beginscherm" and ask for permission from inside the installed app (iOS 16.4+).
4. The new-device push from 0.2-4 now also goes out.
5. Clean up expired subscriptions.

## Done when
A test push arrives on the Android phone and on the iPhone, with the right icon.