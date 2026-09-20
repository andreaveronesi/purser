// session_rbac_test.go — TDD tests for session cookie RBAC + /me endpoint.
//
// These tests verify:
//   1. A session cookie whose role was resolved at login time passes RBAC
//      without a Bearer token (FIX 1 — oidcMiddleware injects ctxKeyOIDCRole
//      from the OIDCSession row on the cookie path).
//   2. GET /api/v1/platform/users/me returns role, is_platform_admin, and email
//      for an authenticated caller (FIX 2 — handleGetMe is completed).
//
// All tests are written BEFORE the implementation so they fail-red first.
package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/purser/purser/go/controlplane/registry"
	"github.com/purser/purser/go/controlplane/server"
)

// newSessionRoleServer builds a server+registry pair configured for OIDC with
// a fakeClaimsVerifier (so VerifyClaims is available), group mappings, and a
// session secret. The returned reg is a real SQLite registry so the OIDCSession
// table is exercised end-to-end.
func newSessionRoleServer(
	t *testing.T,
	sub, email string,
	groups []string,
	groupMappings map[string]string,
	tokenEndpoint string,
) (*server.Server, *registry.SQLiteRegistry) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "session_role_test.db")
	reg, err := registry.Open(dbPath)
	if err != nil {
		t.Fatalf("open registry: %v", err)
	}
	if err := reg.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { reg.Close() })

	verifier := &fakeClaimsVerifier{claims: &server.TokenClaims{
		Sub:    sub,
		Email:  email,
		Groups: groups,
	}}
	srv := server.New(reg, server.Config{
		Addr:          ":0",
		OIDCVerifier:  verifier,
		SessionSecret: testSessionKey,
		OIDC: &server.OIDCConfig{
			Issuer:        "https://test-idp.example.com",
			ClientID:      "test-client",
			RedirectURI:   "http://localhost:8080/auth/callback",
			TokenEndpoint: tokenEndpoint,
			GroupMappings: groupMappings,
		},
	})
	return srv, reg
}

// TestSessionCookieWithAdminRolePasses verifies that a browser session cookie
// whose OIDC group claim maps to "admin" passes RBAC for mutating POST requests.
// Before FIX 1 this returns 401 (cookie sets no role → rbacMiddleware 401s).
func TestSessionCookieWithAdminRolePasses(t *testing.T) {
	idp := mockIdPServer(t)
	mappings := map[string]string{"purser-admins": "admin", "purser-viewers": "viewer"}
	srv, _ := newSessionRoleServer(t,
		"user-admin-1", "admin@example.com",
		[]string{"purser-admins"},
		mappings,
		idp.URL,
	)

	// Perform full OIDC login flow → obtain session cookie.
	cookieValue := fullLoginFlow(t, srv, idp.URL)

	// POST /api/v1/apikeys with only the session cookie (no Bearer token).
	req := httptest.NewRequest(http.MethodPost, "/api/v1/apikeys",
		strings.NewReader(`{"name":"test","tenant":"t1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "purser_session", Value: cookieValue})

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("admin session cookie: POST /api/v1/apikeys: got 401 (cookie RBAC not wired); want 2xx or 403; body=%s",
			rec.Body.String())
	}
	// Admin should get 201 Created (or 400/422 for malformed body — anything except 401/403).
	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin session cookie: POST /api/v1/apikeys: got 403; admin should pass RBAC; body=%s",
			rec.Body.String())
	}
}

// TestSessionCookieWithViewerRoleBlocked verifies that a viewer session cookie
// is denied on mutating (POST) requests with 403, not 401.
// Before FIX 1 this returns 401 instead of 403.
func TestSessionCookieWithViewerRoleBlocked(t *testing.T) {
	idp := mockIdPServer(t)
	mappings := map[string]string{"purser-admins": "admin", "purser-viewers": "viewer"}
	srv, _ := newSessionRoleServer(t,
		"user-viewer-1", "viewer@example.com",
		[]string{"purser-viewers"},
		mappings,
		idp.URL,
	)

	cookieValue := fullLoginFlow(t, srv, idp.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/apikeys",
		strings.NewReader(`{"name":"bad","tenant":"t1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "purser_session", Value: cookieValue})

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer session cookie: POST /api/v1/apikeys: got %d; want 403; body=%s",
			rec.Code, rec.Body.String())
	}
}

// TestGetMeIncludesRoleAndEmail verifies that GET /api/v1/platform/users/me
// returns the caller's role, email, and is_platform_admin flag when the request
// carries a session cookie with a resolved role.
// Before FIX 2 the endpoint returns a stub "Wave 3" note without role/email.
func TestGetMeIncludesRoleAndEmail(t *testing.T) {
	idp := mockIdPServer(t)
	mappings := map[string]string{"purser-admins": "admin"}
	srv, _ := newSessionRoleServer(t,
		"user-me-1", "me@example.com",
		[]string{"purser-admins"},
		mappings,
		idp.URL,
	)

	cookieValue := fullLoginFlow(t, srv, idp.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/platform/users/me", nil)
	req.AddCookie(&http.Cookie{Name: "purser_session", Value: cookieValue})

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /me: status=%d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode /me body: %v; raw=%s", err, rec.Body.String())
	}

	// role must be present and correct.
	role, _ := body["role"].(string)
	if role != "admin" {
		t.Errorf("/me: role=%q, want \"admin\"", role)
	}

	// email must be present.
	email, _ := body["email"].(string)
	if email != "me@example.com" {
		t.Errorf("/me: email=%q, want \"me@example.com\"", email)
	}

	// is_platform_admin must be true for admin role.
	isPlatformAdmin, _ := body["is_platform_admin"].(bool)
	if !isPlatformAdmin {
		t.Errorf("/me: is_platform_admin=false, want true for admin role")
	}

	// The Wave 3 stub note must be gone.
	if note, ok := body["note"]; ok {
		t.Errorf("/me: unexpected note field still present: %v", note)
	}
}
