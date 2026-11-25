package push

import (
	"crypto/ecdh"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
)

// maxEndpointLen caps the endpoint URL. Real ones are a few hundred
// characters; the cap keeps a hostile client from storing megabytes.
const maxEndpointLen = 2048

// ErrEndpoint and ErrKeys mark a subscription the guard refuses; the API
// answers 400 for them.
var (
	ErrEndpoint = errors.New("push: endpoint not allowed")
	ErrKeys     = errors.New("push: invalid subscription keys")
)

// errAddress is what the dialer returns for a refused IP address, kept
// apart from ErrEndpoint so tests can see which layer refused.
var errAddress = errors.New("push: address not allowed")

// pushHosts are the push services of Chrome and Android (FCM) and Firefox;
// pushSuffixes the domains of Safari and iOS (Apple) and Edge on Windows,
// which hand out endpoints on several subdomains. The leading dot makes a
// suffix match only whole labels: "evilpush.apple.com" is not under it.
var (
	pushHosts    = []string{"fcm.googleapis.com", "updates.push.services.mozilla.com"}
	pushSuffixes = []string{".push.apple.com", ".notify.windows.com"}
)

// ValidateEndpoint checks a push endpoint the browser sent: https on port
// 443, a host of a known push service, no userinfo or fragment, at most
// 2048 characters. It runs when a subscription is stored and again before
// every send, so a row that predates a rule change is never used.
func ValidateEndpoint(endpoint string) error {
	u, err := parseEndpoint(endpoint)
	if err != nil {
		return err
	}
	host := u.Hostname()
	if port := u.Port(); port != "" && port != "443" {
		return fmt.Errorf("%w: port %s", ErrEndpoint, port)
	}
	if !allowedHost(host) {
		return fmt.Errorf("%w: host %q is not a known push service", ErrEndpoint, host)
	}
	return nil
}

// parseEndpoint holds the checks that do not depend on the host and port,
// shared with the test guard.
func parseEndpoint(endpoint string) (*url.URL, error) {
	if len(endpoint) > maxEndpointLen {
		return nil, fmt.Errorf("%w: longer than %d characters", ErrEndpoint, maxEndpointLen)
	}
	if strings.Contains(endpoint, "#") {
		return nil, fmt.Errorf("%w: fragment", ErrEndpoint)
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("%w: not a URL", ErrEndpoint)
	}
	if u.Scheme != "https" {
		return nil, fmt.Errorf("%w: scheme must be https", ErrEndpoint)
	}
	if u.User != nil {
		return nil, fmt.Errorf("%w: userinfo", ErrEndpoint)
	}
	if u.Opaque != "" || u.Host == "" {
		return nil, fmt.Errorf("%w: no host", ErrEndpoint)
	}
	return u, nil
}

func allowedHost(host string) bool {
	host = strings.ToLower(host)
	// "fcm.googleapis.com." resolves to the same place but would slip past
	// an exact match; IP literals never name a push service.
	if strings.HasSuffix(host, ".") {
		return false
	}
	if _, err := netip.ParseAddr(host); err == nil {
		return false
	}
	for _, h := range pushHosts {
		if host == h {
			return true
		}
	}
	for _, s := range pushSuffixes {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	return false
}

// ValidateKeys checks the two subscription keys: p256dh must be a 65-octet
// uncompressed P-256 point that lies on the curve (crypto/ecdh checks that),
// auth exactly 16 octets. A bad key would fail every send; refusing it at
// subscribe time tells the client at once.
func ValidateKeys(p256dh, auth string) error {
	_, _, err := decodeKeys(p256dh, auth)
	return err
}

func decodeKeys(p256dh, auth string) (ua, secret []byte, err error) {
	ua, err = decodeB64(p256dh)
	if err != nil || len(ua) != 65 || ua[0] != 0x04 {
		return nil, nil, fmt.Errorf("%w: p256dh must be a 65-octet uncompressed P-256 point", ErrKeys)
	}
	if _, err := ecdh.P256().NewPublicKey(ua); err != nil {
		return nil, nil, fmt.Errorf("%w: p256dh is not a point on P-256", ErrKeys)
	}
	secret, err = decodeB64(auth)
	if err != nil || len(secret) != 16 {
		return nil, nil, fmt.Errorf("%w: auth must be 16 octets", ErrKeys)
	}
	return ua, secret, nil
}

// blockedPrefixes are the ranges a push must never reach besides the ones
// netip classifies itself: CGNAT (shared address space, often the ISP or
// a VPN), "this network", and NAT64, which embeds an IPv4 address and could
// otherwise reach 127.0.0.1 through a translator.
var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
}

// publicAddr reports whether ip is a public unicast address.
func publicAddr(ip netip.Addr) bool {
	ip = ip.Unmap() // ::ffff:127.0.0.1 is 127.0.0.1
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() {
		return false
	}
	if ip.Is4() && ip == netip.AddrFrom4([4]byte{255, 255, 255, 255}) {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// dialControl runs after DNS resolution, on the address the socket is about
// to connect to. Checking here rather than on the host name means a push
// host whose DNS answer is changed to 127.0.0.1 or 10.0.0.1 (DNS
// rebinding) still cannot be reached.
func dialControl(network, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", errAddress, address)
	}
	if !publicAddr(ap.Addr()) {
		return fmt.Errorf("%w: %s", errAddress, ap.Addr())
	}
	if ap.Port() != 443 {
		return fmt.Errorf("%w: port %d", errAddress, ap.Port())
	}
	return nil
}
