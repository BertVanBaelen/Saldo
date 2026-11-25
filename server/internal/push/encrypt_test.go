package push

import (
	"bytes"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

// The example of RFC 8291 section 5 and Appendix A, copied verbatim from
// the RFC text (rfc-editor.org); the line breaks and spaces of the RFC
// layout are removed by unb64.
const (
	rfcPlaintext = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"
	rfcASPublic  = `BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg
      Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`
	rfcASPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
	rfcUAPublic  = `BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-
      JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`
	rfcUAPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
	rfcSalt      = "DGv6ra1nlYgDCS1FRnbzlw"
	rfcAuth      = "BTBZMqHH6r4Tts7J_aSIgg"
	rfcECDH      = "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"
	rfcPRKKey    = "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k"
	rfcKeyInfo   = `V2ViUHVzaDogaW5mbwAEJXGyvs3942BVG
      q8e0PTNNmwR zr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3
      ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0Ew
      bZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAv MBKiiujwa7t45ewP`
	rfcIKM     = "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"
	rfcPRK     = "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc"
	rfcCEKInfo = "Q29udGVudC1FbmNvZGluZzogYWVzMTI4Z2NtAA"
	rfcCEK     = "oIhVW04MRdy2XN9CiKLxTg"
	rfcNonceIn = "Q29udGVudC1FbmNvZGluZzogbm9uY2UA"
	rfcNonce   = "4h_95klXJ5E_qnoN"
	rfcHeader  = `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
   mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`
	rfcCipher = `8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs
   bI_0LpXMuGvnzQ`
	// The whole message body of section 5.
	rfcBody = `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
   mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
   pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`
)

func unb64(t *testing.T, s string) []byte {
	t.Helper()
	s = strings.Join(strings.Fields(s), "")
	b, err := b64.DecodeString(s)
	if err != nil {
		t.Fatalf("decode %q: %v", s, err)
	}
	return b
}

func TestRFC8291Vector(t *testing.T) {
	asPriv, err := ecdh.P256().NewPrivateKey(unb64(t, rfcASPrivate))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(asPriv.PublicKey().Bytes(), unb64(t, rfcASPublic)) {
		t.Fatal("as_private does not give as_public")
	}
	uaPublic := unb64(t, rfcUAPublic)
	auth := unb64(t, rfcAuth)
	salt := unb64(t, rfcSalt)

	// The intermediate values, step by step, so a failure shows which
	// step of the key schedule broke.
	uaKey, _ := ecdh.P256().NewPublicKey(uaPublic)
	secret, _ := asPriv.ECDH(uaKey)
	check(t, "ecdh_secret", secret, unb64(t, rfcECDH))
	prkKey, _ := hkdf.Extract(sha256.New, secret, auth)
	check(t, "PRK_key", prkKey, unb64(t, rfcPRKKey))
	keyInfo := append(append([]byte("WebPush: info\x00"), uaPublic...), asPriv.PublicKey().Bytes()...)
	check(t, "key_info", keyInfo, unb64(t, rfcKeyInfo))
	ikm, _ := hkdf.Expand(sha256.New, prkKey, string(keyInfo), 32)
	check(t, "IKM", ikm, unb64(t, rfcIKM))
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	check(t, "PRK", prk, unb64(t, rfcPRK))
	check(t, "cek_info", []byte("Content-Encoding: aes128gcm\x00"), unb64(t, rfcCEKInfo))
	check(t, "nonce_info", []byte("Content-Encoding: nonce\x00"), unb64(t, rfcNonceIn))

	cek, nonce, err := deriveKeys(asPriv, uaKey, auth, salt, uaPublic, asPriv.PublicKey().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	check(t, "CEK", cek, unb64(t, rfcCEK))
	check(t, "NONCE", nonce, unb64(t, rfcNonce))

	// The example uses rs 4096 and no padding beyond the delimiter.
	body, err := encrypt(unb64(t, rfcPlaintext), uaPublic, auth, asPriv, salt, 4096, 0)
	if err != nil {
		t.Fatal(err)
	}
	header := unb64(t, rfcHeader)
	if len(header) != 86 {
		t.Fatalf("RFC header is %d octets", len(header))
	}
	check(t, "header", body[:86], header)
	check(t, "ciphertext", body[86:], unb64(t, rfcCipher))
	check(t, "body", body, unb64(t, rfcBody))
}

func check(t *testing.T, name string, got, want []byte) {
	t.Helper()
	if !bytes.Equal(got, want) {
		t.Errorf("%s:\n got %s\nwant %s", name, b64.EncodeToString(got), b64.EncodeToString(want))
	}
}

// decryptRecord is the receiving side of RFC 8291 and RFC 8188 as a user
// agent implements it, written from the RFC for the tests: it reads the
// header, derives the keys with the user agent's private key and checks the
// padding delimiter.
func decryptRecord(body []byte, uaPriv *ecdh.PrivateKey, auth []byte) ([]byte, error) {
	if len(body) < 21 {
		return nil, errors.New("short header")
	}
	salt := body[:16]
	rs := binary.BigEndian.Uint32(body[16:20])
	idlen := int(body[20])
	if len(body) < 21+idlen {
		return nil, errors.New("short keyid")
	}
	keyid := body[21 : 21+idlen]
	ciphertext := body[21+idlen:]
	if uint32(len(ciphertext)) > rs {
		return nil, errors.New("more than one record")
	}
	asKey, err := ecdh.P256().NewPublicKey(keyid)
	if err != nil {
		return nil, err
	}
	cek, nonce, err := deriveKeys(uaPriv, asKey, auth, salt, uaPriv.PublicKey().Bytes(), keyid)
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(cek)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	plain = bytes.TrimRight(plain, "\x00")
	if len(plain) == 0 || plain[len(plain)-1] != 0x02 {
		return nil, errors.New("padding delimiter is not 0x02")
	}
	return plain[:len(plain)-1], nil
}

func TestDecryptRFCBody(t *testing.T) {
	uaPriv, err := ecdh.P256().NewPrivateKey(unb64(t, rfcUAPrivate))
	if err != nil {
		t.Fatal(err)
	}
	got, err := decryptRecord(unb64(t, rfcBody), uaPriv, unb64(t, rfcAuth))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "When I grow up, I want to be a watermelon" {
		t.Fatalf("got %q", got)
	}
}

func TestEncryptRoundTripWithPadding(t *testing.T) {
	uaPriv, _ := ecdh.P256().GenerateKey(nil)
	auth := bytes.Repeat([]byte{7}, 16)
	msg := []byte(`{"title":"Saldo","body":"Ontgrendel om de details te zien"}`)
	body, err := encryptMessage(msg, uaPriv.PublicKey().Bytes(), auth)
	if err != nil {
		t.Fatal(err)
	}
	// The padded record is a multiple of padBlock plus delimiter and tag.
	if got := len(body) - headerSize - 1 - 16; got%padBlock != 0 || got < len(msg) {
		t.Fatalf("padded plaintext is %d octets", got)
	}
	got, err := decryptRecord(body, uaPriv, auth)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, msg) {
		t.Fatalf("got %q", got)
	}
	// A wrong auth secret must not decrypt.
	if _, err := decryptRecord(body, uaPriv, bytes.Repeat([]byte{8}, 16)); err == nil {
		t.Fatal("decrypted with the wrong auth secret")
	}
}

func TestEncryptSizeLimit(t *testing.T) {
	uaPriv, _ := ecdh.P256().GenerateKey(nil)
	auth := make([]byte, 16)
	if body, err := encryptMessage(make([]byte, maxPlaintext), uaPriv.PublicKey().Bytes(), auth); err != nil || len(body) != recordSize {
		t.Fatalf("max plaintext: len %d, err %v", len(body), err)
	}
	if _, err := encryptMessage(make([]byte, maxPlaintext+1), uaPriv.PublicKey().Bytes(), auth); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over the limit: %v", err)
	}
}
