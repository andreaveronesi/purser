// auth_local.go — built-in local admin username/password authentication.
//
// Endpoint:
//
//	POST /auth/local-login — verify the configured local admin credentials and
//	                         issue the existing HMAC session cookie.
//
// The local admin account is a break-glass / no-IdP path. Its username defaults
// to "admin" (override with PURSER_ADMIN_USERNAME) and its master password is
// read from PURSER_ADMIN_PASSWORD only — never from purser.yaml. When the
// master password is configured the account is enabled AND the demo fail-open
// is closed (anonymous /api/v1/* → 401).
//
// The session is stored in the same oidc_sessions table with
// auth_method='local' and role='admin', so the existing session middleware and
// handleGetMe handle local sessions transparently alongside OIDC and LDAP.
package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/purser/purser/go/controlplane/registry"
)

// constantTimeEqual reports whether a and b are equal, comparing their SHA-256
// digests with crypto/subtle so the comparison is constant-time and does not
// leak the length of the configured secret. Hashing first means the compared
// byte slices are always 32 bytes regardless of input length.
func constantTimeEqual(a, b string) bool {
	ah := sha256.Sum256([]byte(a))
	bh := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ah[:], bh[:]) == 1
}

// handleLocalLogin processes username/password submitted for the built-in local
// admin account. It accepts either a JSON body ({"username":...,"password":...})
// or a form POST (username=...&password=...), mirroring handleLDAPLogin.
//
// POST /auth/local-login
//
// Responses:
//   - 302  success — sets the purser_session cookie and redirects to "/"
//   - 400  missing username or password
//   - 401  invalid credentials (identical message for wrong user or wrong pass)
//   - 404  local admin authentication is not configured
func (s *Server) handleLocalLogin(w http.ResponseWriter, r *http.Request) {
	if !s.localAuthEnabled() {
		s.writeError(w, http.StatusNotFound, "not_configured",
			"local admin authentication is not configured on this server")
		return
	}

	username, password := parseLocalCredentials(r)
	if username == "" || password == "" {
		s.writeError(w, http.StatusBadRequest, "bad_request", "username and password are required")
		return
	}

	// Constant-time compare BOTH username and password. Compute both results
	// before combining them (no early return) so timing does not reveal whether
	// the username or the password was the mismatch.
	userOK := constantTimeEqual(username, s.localAuthUsername)
	passOK := constantTimeEqual(password, s.localAuthPassword)
	if !(userOK && passOK) {
		// Identical error for a wrong username or a wrong password — no account
		// enumeration. Set NO cookie.
		if s.reg != nil {
			_ = s.reg.AppendAudit(r.Context(), &registry.AuditEntry{
				Actor: "local:" + username, Action: "session.local_login_failed",
			})
		}
		s.writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or password")
		return
	}

	// Success: issue a session token (same HMAC scheme as OIDC/LDAP).
	sub := "local:" + s.localAuthUsername
	email := s.localAuthUsername + "@local"
	sessionToken := s.signSession(sub, email)
	tokenHash := sha256HexOf(sessionToken)

	if s.reg != nil {
		_ = s.reg.CreateOIDCSession(r.Context(), &registry.OIDCSession{
			TokenHash:  tokenHash,
			Sub:        sub,
			Email:      email,
			IDPIssuer:  "local",
			AuthMethod: "local",
			Role:       "admin",
			CreatedAt:  time.Now(),
			ExpiresAt:  time.Now().Add(sessionTTL),
		})

		_ = s.reg.AppendAudit(r.Context(), &registry.AuditEntry{
			Actor: "local:" + s.localAuthUsername, Action: "session.local_login",
		})
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(sessionTTL.Seconds()),
	})

	http.Redirect(w, r, "/", http.StatusFound)
}

// parseLocalCredentials extracts username and password from either a JSON body
// (Content-Type application/json) or a standard form POST.
func parseLocalCredentials(r *http.Request) (username, password string) {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return "", ""
		}
		return body.Username, body.Password
	}
	if err := r.ParseForm(); err != nil {
		return "", ""
	}
	return r.FormValue("username"), r.FormValue("password")
}
