package server

import (
	"net/http"
	"strings"

	"github.com/BertVanBaelen/Saldo/server/internal/notify"
)

// The Meldingen settings (0.9-4, docs/api.md "Notifications"): per user, the
// viewer from the session. The push switch of a device is not here (that is
// the device's subscription, "Push"); nothing is cached, so the next run of the
// sender reads what was saved.

// notificationsBody is the answer of GET and PUT /api/notifications.
type notificationsBody struct {
	Channels  notificationChannels `json:"channels"`
	Lookahead int                  `json:"lookahead"`
	Groups    []notificationGroup  `json:"groups"`
	Types     []notificationType   `json:"types"`
}

type notificationChannels struct {
	Email      bool `json:"email"`
	QuietHours bool `json:"quietHours"`
}

type notificationGroup struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type notificationType struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Subline     string `json:"subline"`
	Group       string `json:"group"`
	Dot         string `json:"dot"` // the colour token without "--": neg, warn, shared, green
	Push        bool   `json:"push"`
	Email       bool   `json:"email"`
	EmailLocked bool   `json:"emailLocked"`
}

// writeNotifications answers with the viewer's settings, the defaults merged.
func (s *Server) writeNotifications(w http.ResponseWriter, r *http.Request) {
	st, err := notify.LoadSettings(r.Context(), s.db, viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	body := notificationsBody{
		Channels:  notificationChannels{Email: st.Email, QuietHours: st.QuietHours},
		Lookahead: st.Lookahead,
		Groups:    make([]notificationGroup, 0, len(notify.Groups)),
		Types:     make([]notificationType, 0, len(notify.Types)),
	}
	for _, g := range notify.Groups {
		body.Groups = append(body.Groups, notificationGroup{ID: g.ID, Label: g.Label})
	}
	for _, t := range notify.Types {
		p := st.Prefs[t.Key]
		body.Types = append(body.Types, notificationType{Key: t.Key, Name: t.Name, Subline: t.Subline, Group: t.Group,
			Dot: strings.TrimPrefix(t.Dot, "--"), Push: p.Push, Email: p.Email, EmailLocked: t.AlwaysEmail})
	}
	writeJSON(w, http.StatusOK, body)
}

// GET /api/notifications
func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	s.writeNotifications(w, r)
}

// PUT /api/notifications: a partial update of the channels, the look-ahead and
// the chips of the types it names. Unknown fields and bad values are 400, and
// nothing is saved unless everything is valid. It answers like GET.
func (s *Server) putNotifications(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Channels *struct {
			Email      *bool `json:"email"`
			QuietHours *bool `json:"quietHours"`
		} `json:"channels"`
		Lookahead *int `json:"lookahead"`
		Types     map[string]struct {
			Push  *bool `json:"push"`
			Email *bool `json:"email"`
		} `json:"types"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	patch := notify.SettingsPatch{Lookahead: body.Lookahead}
	if c := body.Channels; c != nil {
		patch.Email, patch.QuietHours = c.Email, c.QuietHours
	}
	if len(body.Types) > 0 {
		patch.Types = make(map[string]notify.PrefPatch, len(body.Types))
		for key, t := range body.Types {
			patch.Types[key] = notify.PrefPatch{Push: t.Push, Email: t.Email}
		}
	}
	if err := notify.UpdateSettings(r.Context(), s.db, viewerOf(r), patch); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	s.writeNotifications(w, r)
}
