// rbac_local_test.go — verifies that configuring the local admin master
// password closes the demo fail-open: anonymous /api/v1/* requests are rejected
// with 401, while a request carrying a valid local session cookie is honored.
// When local auth is NOT configured the demo fail-open is preserved.
package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/purser/purser/go/controlplane/registry"
	"github.com/purser/purser/go/controlplane/server"
)

// loginLocal performs POST /auth/local-login against srv and returns the
// purser_session cookie value. It fails the test when login does not succeed.
func loginLocal(t *testing.T, srv *server.Server) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(`{"username":"admin","password":"s3cret-master-key"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("loginLocal: status = %d, want 302; body=%s", rec.Code, rec.Body.String())
	}
	cookie := sessionCookie(rec)
	if cookie == "" {
		t.Fatalf("loginLocal: no purser_session cookie set")
	}
	return cookie
}

// TestLocalAuth_AnonymousRefused verifies that with local auth enabled an
// anonymous management request is rejected with 401 (demo fail-open closed).
func TestLocalAuth_AnonymousRefused(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET /api/v1/nodes = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
}

// TestLocalAuth_CookieAllowed verifies that a request carrying a valid local
// session cookie is honored (not 401/403).
func TestLocalAuth_CookieAllowed(t *testing.T) {
	// Reuse one registry so the session persisted at login is visible to the
	// middleware's revocation lookup on the subsequent request.
	reg, err := registry.Open(filepath.Join(t.TempDir(), "local_cookie_test.db"))
	if err != nil {
		t.Fatalf("open registry: %v", err)
	}
	if err := reg.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { reg.Close() })
	srv := newLocalAuthSrv(t, reg)

	cookie := loginLocal(t, srv)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	req.AddCookie(&http.Cookie{Name: "purser_session", Value: cookie})
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
		t.Fatalf("authenticated GET /api/v1/nodes = %d, want not 401/403; body=%s", rec.Code, rec.Body.String())
	}
}

// TestLocalAuth_DisabledStillOpen verifies that when local auth is NOT
// configured the demo fail-open is preserved: anonymous /api/v1/* passes.
func TestLocalAuth_DisabledStillOpen(t *testing.T) {
	reg := newReg(t)
	srv := server.New(reg, server.Config{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("anonymous GET /api/v1/nodes with no auth configured = 401, want pass-through; body=%s", rec.Body.String())
	}
}
