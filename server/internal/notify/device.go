package notify

import (
	"context"
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

const devicesPath = "/instellingen/toestellen"

// NewDevice delivers "Nieuw toestel aangemeld" (plan 0.9-3b step 6) for the
// user's device that became trusted at now: a Security message (quiet hours
// do not hold it, the e-mail always goes, key device:<id>). The push goes to
// the user's other devices: the new one has no subscription yet, and SkipDevice
// keeps it out anyway. It is not a trigger: sign-in calls it in the
// background, and a send that fails is not tried again (as the direct mail of
// before). The installed iPhone app counts as a new device.
func (s *Service) NewDevice(ctx context.Context, now time.Time, user, device int64, name string) error {
	em, err := mail.NewDevice("", name, now, s.abs(devicesPath))
	if err != nil {
		return err
	}
	p := Payload(TypeDevice, Text{Device: name}, Detail)
	p.URL, p.Tag = devicesPath, fmt.Sprintf("device-%d", device)
	_, err = s.Deliver(ctx, now, Message{User: user, Type: TypeDevice, Key: fmt.Sprintf("device:%d", device),
		Push: &p, Email: &em, Expires: now.Add(EventExpiry), SkipDevice: device})
	return err
}
