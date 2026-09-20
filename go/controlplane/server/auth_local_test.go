// auth_local_test.go — unit tests for the built-in local admin login endpoint.
//
// The local admin account (POST /auth/local-login) verifies a configured
// username+password in constant time and issues the existing HMAC session
// cookie (stored in oidc_sessions with auth_method='local', role='admin').
// When a master password is configured the demo fail-open is closed — that
// behaviour is covered in rbac_local_test.go.
package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/purser/purser/go/controlplane/registry"
	"github.com/purser/purser/go/controlplane/server"
)

// newLocalAuthSrv builds a test server with the built-in local admin account
// enabled (username "admin", password "s3cret-master-key"). Pass reg to reuse a
// registry across requests; when nil a fresh one is created.
func newLocalAuthSrv(t *testing.T, reg registry.Registry) *server.Server {
	t.Helper()
	if reg == nil {
		var err error
		reg, err = registry.Open(filepath.Join(t.TempDir(), "local_auth_test.db"))
		if err != nil {
			t.Fatalf("open registry: %v", err)
		}
		if err := reg.Migrate(context.Background()); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		t.Cleanup(func() { reg.Close() })
	}
	return server.New(reg, server.Config{
		Addr:              ":0",
		LocalAuthUsername: "admin",
		LocalAuthPassword: "s3cret-master-key",
	})
}

// sessionCookie returns the value of the purser_session cookie set on the
// response, or "" when none was set.
func sessionCookie(rec *httptest.ResponseRecorder) string {
	for _, c := range rec.Result().Cookies() {
		if c.Name == "purser_session" {
			return c.Value
		}
	}
	return ""
}

// TestLocalLogin_Success verifies that valid JSON credentials yield a 302
// redirect and set a signed purser_session cookie.
func TestLocalLogin_Success(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(`{"username":"admin","password":"s3cret-master-key"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body=%s", rec.Code, rec.Body.String())
	}
	if cookie := sessionCookie(rec); cookie == "" {
		t.Fatalf("expected purser_session cookie to be set, got none")
	}
}

// TestLocalLogin_SuccessForm verifies that form-encoded credentials also work,
// mirroring the LDAP login form path.
func TestLocalLogin_SuccessForm(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	form := url.Values{"username": {"admin"}, "password": {"s3cret-master-key"}}
	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body=%s", rec.Code, rec.Body.String())
	}
	if cookie := sessionCookie(rec); cookie == "" {
		t.Fatalf("expected purser_session cookie to be set, got none")
	}
}

// TestLocalLogin_WrongPassword verifies that a wrong password yields 401 and no
// session cookie.
func TestLocalLogin_WrongPassword(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(`{"username":"admin","password":"wrong"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	if cookie := sessionCookie(rec); cookie != "" {
		t.Fatalf("expected no session cookie on failure, got %q", cookie)
	}
}

// TestLocalLogin_WrongUsername verifies that a wrong username yields 401 and no
// session cookie. The message is identical to the wrong-password case (no user
// enumeration).
func TestLocalLogin_WrongUsername(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(`{"username":"root","password":"s3cret-master-key"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	if cookie := sessionCookie(rec); cookie != "" {
		t.Fatalf("expected no session cookie on failure, got %q", cookie)
	}
}

// TestLocalLogin_MissingField verifies that an empty username or password
// yields 400 before any credential comparison.
func TestLocalLogin_MissingField(t *testing.T) {
	srv := newLocalAuthSrv(t, nil)

	cases := []string{
		`{"username":"","password":"s3cret-master-key"}`,
		`{"username":"admin","password":""}`,
		`{}`,
	}
	for _, body := range cases {
		req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body=%s: status = %d, want 400", body, rec.Code)
		}
	}
}

// TestLocalLogin_Disabled verifies that the endpoint returns 404 when no master
// password is configured (local admin disabled).
func TestLocalLogin_Disabled(t *testing.T) {
	reg := newReg(t)
	srv := server.New(reg, server.Config{})

	req := httptest.NewRequest(http.MethodPost, "/auth/local-login",
		strings.NewReader(`{"username":"admin","password":"whatever"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}
