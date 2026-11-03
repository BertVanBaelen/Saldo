package server

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// maxBody limits JSON request bodies.
const maxBody = 64 << 10

// errorBody is the error shape of docs/api.md.
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

var (
	errMediaType = errors.New("unsupported media type")
	errTooLarge  = errors.New("body too large")
)

// decodeJSON reads a JSON object body into dst. Unknown fields, trailing
// data and anything but application/json are rejected; a JSON content type
// also keeps plain HTML forms on other sites from posting here.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		return errMediaType
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return errTooLarge
		}
		return apperr.Invalid("De gegevens kloppen niet.")
	}
	if dec.More() {
		return apperr.Invalid("De gegevens kloppen niet.")
	}
	return nil
}

// fail answers an error from a handler; notFound is the Dutch message for a
// missing or hidden resource.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error, notFound string) {
	var invalid *apperr.InvalidError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, "invalid", invalid.Message)
	case errors.Is(err, apperr.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", notFound)
	case errors.Is(err, apperr.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "Je mag deze rekening alleen bekijken.")
	case errors.Is(err, errMediaType):
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Stuur de gegevens als JSON.")
	case errors.Is(err, errTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "De aanvraag is te groot.")
	default:
		s.log.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "Er ging iets mis. Probeer het later opnieuw.")
	}
}
