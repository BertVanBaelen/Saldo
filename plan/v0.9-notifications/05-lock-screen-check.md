# 0.9-5 · Lock screen check on both phones

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | planned |
| Size | S |
| Features | NOTIF-5 |
| Concepts | [notification](../../analysis/concepts/notification.md) |
| Screens | [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | risks 14, 19 |
| Depends on | [0.9-2](02-web-push.md) |

## Goal
No amounts or account names readable on a locked phone, on Android and on iPhone.

## Steps
1. Test on the Android phone with "sensitive notifications" on and off, and on the iPhone with "Toon voorvertoning" set to always and to when unlocked.
2. If the PWA cannot control it: leave amounts out of the push text, or send through the Home Assistant companion app (private notifications) **[verify]**.
3. Record the outcome in notification.

## Done when
The lock screen of both phones shows only "Planning: actie nodig" / "Bankkoppeling verloopt binnenkort" style text.