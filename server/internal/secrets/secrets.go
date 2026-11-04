// Package secrets encrypts small secrets (Enable Banking private keys, bank
// session ids) at rest. The key is a file next to the database, not inside it:
// that protects a leaked saldo.db, not a leaked full backup, so Home Assistant
// backups must be encrypted (analysis 7).
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const keySize = 32 // AES-256

// Box seals and opens secrets with AES-256-GCM.
type Box struct{ aead cipher.AEAD }

// Load reads the key file, creating it with a random key on first start.
func Load(path string) (*Box, error) {
	key, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		key, err = create(path)
	}
	if err != nil {
		return nil, fmt.Errorf("secret key: %w", err)
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("secret key %s: %d bytes, want %d", path, len(key), keySize)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead}, nil
}

func create(path string) ([]byte, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	// O_EXCL: two starts racing never overwrite each other's key.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	if _, err := f.Write(key); err != nil {
		f.Close()
		return nil, err
	}
	return key, f.Close()
}

// Seal returns nonce || ciphertext.
func (b *Box) Seal(plain []byte) []byte {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(err) // crypto/rand does not fail on a working system
	}
	return b.aead.Seal(nonce, nonce, plain, nil)
}

// Open reverses Seal; it fails on a wrong key or tampered data.
func (b *Box) Open(sealed []byte) ([]byte, error) {
	n := b.aead.NonceSize()
	if len(sealed) < n+b.aead.Overhead() {
		return nil, errors.New("secret too short")
	}
	return b.aead.Open(nil, sealed[:n], sealed[n:], nil)
}
