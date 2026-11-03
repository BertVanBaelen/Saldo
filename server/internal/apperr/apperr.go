// Package apperr holds the errors that domain packages return and the HTTP
// layer translates: not found (also for anything the viewer may not see),
// forbidden (visible but read-only) and invalid input with a Dutch message.
package apperr

import "errors"

var (
	// ErrNotFound: the resource does not exist or the viewer cannot see it.
	ErrNotFound = errors.New("not found")
	// ErrForbidden: the viewer can see the resource but may not change it.
	ErrForbidden = errors.New("forbidden")
)

// InvalidError is a validation error; Message is Dutch and shown to the user.
type InvalidError struct {
	Message string
}

func (e *InvalidError) Error() string { return "invalid: " + e.Message }

// Invalid returns a validation error with a Dutch message for the user.
func Invalid(message string) error { return &InvalidError{Message: message} }
