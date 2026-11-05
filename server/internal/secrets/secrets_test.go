package secrets

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRoundTripAndPersistentKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "secret.key")
	box, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	sealed := box.Seal([]byte("pem-key"))
	if bytes.Contains(sealed, []byte("pem-key")) {
		t.Fatal("ciphertext holds the plaintext")
	}
	if bytes.Equal(sealed, box.Seal([]byte("pem-key"))) {
		t.Fatal("two seals of the same value are identical: nonce reused")
	}

	again, err := Load(path) // a restart reads the same key
	if err != nil {
		t.Fatal(err)
	}
	got, err := again.Open(sealed)
	if err != nil || string(got) != "pem-key" {
		t.Fatalf("Open after reload = %q, %v", got, err)
	}
}

func TestOpenRejectsTamperedWrongKeyAndShort(t *testing.T) {
	dir := t.TempDir()
	a, _ := Load(filepath.Join(dir, "a.key"))
	b, _ := Load(filepath.Join(dir, "b.key"))
	sealed := a.Seal([]byte("secret"))

	if _, err := b.Open(sealed); err == nil {
		t.Fatal("opened with the wrong key")
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := a.Open(sealed); err == nil {
		t.Fatal("opened tampered data")
	}
	if _, err := a.Open([]byte("x")); err == nil {
		t.Fatal("opened too-short data")
	}
}

func TestLoadRefusesBadKeyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret.key")
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("accepted a key of the wrong size")
	}
}
