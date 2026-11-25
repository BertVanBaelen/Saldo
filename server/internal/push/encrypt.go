package push

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

// RFC 8291 section 4: a push service need not accept more than 4096 octets
// of body. One record of that size, minus the 86-octet header, the padding
// delimiter and the 16-octet GCM tag, leaves 3993 octets of plaintext.
const (
	recordSize   = 4096
	headerSize   = 16 + 4 + 1 + 65 // salt, rs, idlen, keyid
	maxPlaintext = recordSize - headerSize - 1 - 16
)

// padBlock rounds the plaintext up to a multiple of this many octets, so the
// push service, which sees only the ciphertext, cannot tell two messages of
// a similar length apart.
const padBlock = 64

// ErrTooLarge means the payload does not fit in one 4096-octet record.
var ErrTooLarge = errors.New("push: payload too large")

// encryptMessage encrypts plaintext for the subscription keys with a fresh
// ephemeral key pair and salt, as RFC 8291 requires for every message.
func encryptMessage(plaintext, uaPublic, authSecret []byte) ([]byte, error) {
	asPrivate, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	pad := 0
	if r := len(plaintext) % padBlock; r != 0 {
		pad = padBlock - r
	}
	if len(plaintext)+pad > maxPlaintext {
		pad = maxPlaintext - len(plaintext)
	}
	return encrypt(plaintext, uaPublic, authSecret, asPrivate, salt, recordSize, pad)
}

// encrypt is the RFC 8291 / RFC 8188 computation with every random input
// passed in, so the RFC 8291 Appendix A vector can be checked byte for byte.
// It writes a single record: header (salt, rs, idlen, keyid = the
// application server's public key) followed by
// AES-128-GCM(plaintext || 0x02 || pad zero octets).
func encrypt(plaintext, uaPublic, authSecret []byte, asPrivate *ecdh.PrivateKey, salt []byte, rs uint32, pad int) ([]byte, error) {
	if len(salt) != 16 {
		return nil, errors.New("push: salt must be 16 octets")
	}
	if pad < 0 || len(plaintext)+pad > maxPlaintext || uint64(len(plaintext)+1+pad+16) > uint64(rs) {
		return nil, ErrTooLarge
	}
	uaKey, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("push: user agent key: %w", err)
	}
	cek, nonce, err := deriveKeys(asPrivate, uaKey, authSecret, salt, uaPublic, asPrivate.PublicKey().Bytes())
	if err != nil {
		return nil, err
	}

	asPublic := asPrivate.PublicKey().Bytes()
	header := make([]byte, 0, headerSize)
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, rs)
	header = append(header, byte(len(asPublic)))
	header = append(header, asPublic...)

	record := make([]byte, 0, len(plaintext)+1+pad)
	record = append(record, plaintext...)
	record = append(record, 0x02) // delimiter of the last (and only) record
	record = append(record, make([]byte, pad)...)

	gcm, err := newGCM(cek)
	if err != nil {
		return nil, err
	}
	// The sequence number of the first record is zero, so the nonce is used
	// as derived (RFC 8291 3.4).
	return gcm.Seal(header, nonce, record, nil), nil
}

// deriveKeys runs the key schedule of RFC 8291 3.3 and 3.4. Both sides call
// it: the sender with its private key and the receiver's public key, the
// receiver (in the tests) the other way round. uaPublic and asPublic are the
// uncompressed points in that fixed order, whichever side computes.
func deriveKeys(priv *ecdh.PrivateKey, peer *ecdh.PublicKey, authSecret, salt, uaPublic, asPublic []byte) (cek, nonce []byte, err error) {
	if len(authSecret) != 16 {
		return nil, nil, errors.New("push: auth secret must be 16 octets")
	}
	ecdhSecret, err := priv.ECDH(peer)
	if err != nil {
		return nil, nil, err
	}
	keyInfo := make([]byte, 0, 14+65+65)
	keyInfo = append(keyInfo, "WebPush: info\x00"...)
	keyInfo = append(keyInfo, uaPublic...)
	keyInfo = append(keyInfo, asPublic...)
	ikm, err := hkdf.Key(sha256.New, ecdhSecret, authSecret, string(keyInfo), 32)
	if err != nil {
		return nil, nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, nil, err
	}
	if cek, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, err
	}
	if nonce, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12); err != nil {
		return nil, nil, err
	}
	return cek, nonce, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
