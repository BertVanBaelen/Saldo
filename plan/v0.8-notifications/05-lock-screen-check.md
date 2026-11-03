# 0.8-5 · Lock screen check

| | |
|---|---|
| Version | [0.8 Notifications](README.md) |
| Status | planned |
| Features | NOTIF-5 |
| Concepts | [notification](../../analysis/concepts/notification.md) |
| Screens | [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | risk 14 |
| Depends on | 0.8-2 |

## Goal
No amounts or account names readable on a locked phone.

## Steps
1. Test on a real Android phone with "sensitive notifications" settings on and off.
2. If the PWA cannot control it: leave amounts out of the push text, or send through the Home Assistant companion app (private notifications) **[verify]**.
3. Record the outcome in [notification](../../analysis/concepts/notification.md).

## Done when
The lock screen shows only "Planning: actie nodig" / "Bankkoppeling verloopt binnenkort" style text.
