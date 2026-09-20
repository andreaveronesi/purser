package server_test

// rbac_v2_hardening_test.go — TDD tests for Phase 3.3 routePermission expansion.
//
// Each group covers one of the newly-mapped route families:
//   - Org/Team CRUD      (org:teams:create / org:teams:delete)
//   - Custom Roles CRUD  (org:roles:create / org:roles:delete)
//   - Billing reads      (team:metrics:view)
//   - GDPR operations    (platform:orgs:delete proxy)
//
// For each family we verify the three cases required by the brief:
//   1. A key carrying the sufficient permission passes (non-403).
//   2. A key WITHOUT the permission is rejected (403).
//   3. A legacy platform_admin ("admin" role) always passes.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/purser/purser/go/controlplane/registry"
	"github.com/purser/purser/go/controlplane/server"
)

// ---------------------------------------------------------------------------
// Org/Team CRUD — POST /api/v1/platform/orgs/{orgId}/teams
// ---------------------------------------------------------------------------

// TestRBACv2_H_OrgTeamCreate_SufficientPerm: a key with org:teams:create (via
// team membership + custom role) must NOT be blocked with 403 on
// POST /api/v1/platform/orgs/{orgId}/teams.
// RED before routePermission is extended + inline isOrgAdminOrPlatformAdmin removed.
func TestRBACv2_H_OrgTeamCreate_SufficientPerm(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()

	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-tc", Name: "Team Create Org", Slug: "team-create-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}
	if err := reg.CreateTeam(ctx, &registry.Team{
		ID: "team-tc", OrgID: "org-tc", Name: "Scoping Team", Slug: "scoping-team",
	}); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := reg.CreateCustomRole(ctx, &registry.CustomRole{
		ID:          "org-team-mgr",
		OrgID:       "org-tc",
		Name:        "Org Team Manager",
		Permissions: []string{registry.PermOrgTeamsCreate},
	}); err != nil {
		t.Fatalf("create custom role: %v", err)
	}
	// Key with legacy "viewer" role — should NOT pass the legacy switch for POST.
	// After fix: routePermission maps org:teams:create, custom role grants it.
	token := seedKeyV2(t, reg, "key-tc", "viewer", "team-tc")
	if err := reg.AddTeamMember(ctx, &registry.TeamMember{
		TeamID:  "team-tc",
		UserSub: "key-tc",
		RoleID:  "org-team-mgr",
	}); err != nil {
		t.Fatalf("add team member: %v", err)
	}

	srv := server.New(reg, server.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-tc/teams",
		strings.NewReader(`{"name":"New Team","slug":"new-team-slug"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("key with org:teams:create on POST /platform/orgs/{orgId}/teams got 403; body=%s",
			rec.Body.String())
	}
}

// TestRBACv2_H_OrgTeamCreate_InsufficientPerm: a plain viewer key (no
// org:teams:create) must remain blocked with 403.
func TestRBACv2_H_OrgTeamCreate_InsufficientPerm(t *testing.T) {
	reg := newReg(t)
	// Viewer key: no tenant, no custom role — carries only team:metrics:view etc.
	token := seedKeyV2(t, reg, "key-tc-noperm", "viewer", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-x/teams",
		strings.NewReader(`{"name":"Bad Team","slug":"bad-team"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer key on POST /platform/orgs/{orgId}/teams got %d, want 403; body=%s",
			rec.Code, rec.Body.String())
	}
}

// TestRBACv2_H_OrgTeamCreate_PlatformAdmin: legacy admin key must always pass.
func TestRBACv2_H_OrgTeamCreate_PlatformAdmin(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()
	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-tca", Name: "Admin Org", Slug: "admin-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}

	token := seedKeyV2(t, reg, "key-tc-admin", "admin", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-tca/teams",
		strings.NewReader(`{"name":"Admin Team","slug":"admin-team"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin key on POST /platform/orgs/{orgId}/teams got 403; body=%s",
			rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Custom Roles CRUD — POST /api/v1/platform/orgs/{orgId}/roles
// ---------------------------------------------------------------------------

// TestRBACv2_H_OrgRolesCreate_SufficientPerm: a key with org:roles:create must
// NOT be blocked on POST /api/v1/platform/orgs/{orgId}/roles.
// RED before routePermission is extended + inline isAdminActor removed from
// handleCreateRole.
func TestRBACv2_H_OrgRolesCreate_SufficientPerm(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()

	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-rc", Name: "Roles Org", Slug: "roles-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}
	if err := reg.CreateTeam(ctx, &registry.Team{
		ID: "team-rc", OrgID: "org-rc", Name: "Roles Team", Slug: "roles-team",
	}); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := reg.CreateCustomRole(ctx, &registry.CustomRole{
		ID:          "role-mgr",
		OrgID:       "org-rc",
		Name:        "Role Manager",
		Permissions: []string{registry.PermOrgRolesCreate},
	}); err != nil {
		t.Fatalf("create custom role: %v", err)
	}
	token := seedKeyV2(t, reg, "key-rc", "viewer", "team-rc")
	if err := reg.AddTeamMember(ctx, &registry.TeamMember{
		TeamID:  "team-rc",
		UserSub: "key-rc",
		RoleID:  "role-mgr",
	}); err != nil {
		t.Fatalf("add team member: %v", err)
	}

	srv := server.New(reg, server.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-rc/roles",
		strings.NewReader(`{"name":"Custom Dev Role","permissions":["team:models:deploy"]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("key with org:roles:create on POST /platform/orgs/{orgId}/roles got 403; body=%s",
			rec.Body.String())
	}
}

// TestRBACv2_H_OrgRolesCreate_InsufficientPerm: viewer key without org:roles:create → 403.
func TestRBACv2_H_OrgRolesCreate_InsufficientPerm(t *testing.T) {
	reg := newReg(t)
	token := seedKeyV2(t, reg, "key-rc-noperm", "viewer", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-any/roles",
		strings.NewReader(`{"name":"Sneaky Role"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer key on POST /platform/orgs/{orgId}/roles got %d, want 403; body=%s",
			rec.Code, rec.Body.String())
	}
}

// TestRBACv2_H_OrgRolesCreate_PlatformAdmin: admin key always passes.
func TestRBACv2_H_OrgRolesCreate_PlatformAdmin(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()
	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-rca", Name: "Admin Roles Org", Slug: "admin-roles-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}

	token := seedKeyV2(t, reg, "key-rc-admin", "admin", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/platform/orgs/org-rca/roles",
		strings.NewReader(`{"name":"Admin Created Role","permissions":[]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin key on POST /platform/orgs/{orgId}/roles got 403; body=%s",
			rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Billing reads — GET /api/v1/billing/report
// ---------------------------------------------------------------------------

// TestRBACv2_H_BillingRead_SufficientPerm: an inference-scoped key that has
// team:metrics:view via a custom role must NOT be blocked on GET /billing/report.
// Currently blocked by the legacy inference-role switch; after fix, routePermission
// maps team:metrics:view and the custom-role permission grants access.
// RED before routePermission is extended for billing routes.
func TestRBACv2_H_BillingRead_SufficientPerm(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()

	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-br", Name: "Billing Org", Slug: "billing-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}
	if err := reg.CreateTeam(ctx, &registry.Team{
		ID: "team-br", OrgID: "org-br", Name: "Billing Team", Slug: "billing-team",
	}); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := reg.CreateCustomRole(ctx, &registry.CustomRole{
		ID:          "metrics-reader",
		OrgID:       "org-br",
		Name:        "Metrics Reader",
		Permissions: []string{registry.PermTeamMetricsView},
	}); err != nil {
		t.Fatalf("create custom role: %v", err)
	}
	// Inference-scoped key — legacy switch blocks /api/v1/; routePermission bypasses it.
	token := seedKeyV2(t, reg, "key-br", "inference", "team-br")
	if err := reg.AddTeamMember(ctx, &registry.TeamMember{
		TeamID:  "team-br",
		UserSub: "key-br",
		RoleID:  "metrics-reader",
	}); err != nil {
		t.Fatalf("add team member: %v", err)
	}

	srv := server.New(reg, server.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/report", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	srv.Handler().ServeHTTP(rec, req)

	// Handler returns 402 (no billing license in test) or 200, but NOT 403.
	if rec.Code == http.StatusForbidden {
		t.Fatalf("inference key with team:metrics:view on GET /billing/report got 403; body=%s",
			rec.Body.String())
	}
}

// TestRBACv2_H_BillingRead_InsufficientPerm: inference-only key (no team membership)
// must remain blocked with 403.
func TestRBACv2_H_BillingRead_InsufficientPerm(t *testing.T) {
	reg := newReg(t)
	token := seedKeyV2(t, reg, "key-br-noperm", "inference", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/report", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("bare inference key on GET /billing/report got %d, want 403; body=%s",
			rec.Code, rec.Body.String())
	}
}

// TestRBACv2_H_BillingRead_PlatformAdmin: admin key always passes.
func TestRBACv2_H_BillingRead_PlatformAdmin(t *testing.T) {
	reg := newReg(t)
	token := seedKeyV2(t, reg, "key-br-admin", "admin", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/report", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin key on GET /billing/report got 403; body=%s", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// GDPR operations — POST /api/v1/gdpr/erasure
// ---------------------------------------------------------------------------

// TestRBACv2_H_GDPRErase_SufficientPerm: a key with platform:orgs:delete (the
// proxy permission for GDPR) must NOT be blocked on POST /api/v1/gdpr/erasure.
// RED before routePermission extended + requestIsAdmin inline removed.
func TestRBACv2_H_GDPRErase_SufficientPerm(t *testing.T) {
	reg := newReg(t)
	ctx := context.Background()

	if err := reg.CreateOrganization(ctx, &registry.Organization{
		ID: "org-gd", Name: "GDPR Org", Slug: "gdpr-org",
	}); err != nil {
		t.Fatalf("create org: %v", err)
	}
	if err := reg.CreateTeam(ctx, &registry.Team{
		ID: "team-gd", OrgID: "org-gd", Name: "GDPR Team", Slug: "gdpr-team",
	}); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := reg.CreateCustomRole(ctx, &registry.CustomRole{
		ID:          "platform-ops",
		OrgID:       "org-gd",
		Name:        "Platform Ops",
		Permissions: []string{registry.PermPlatformOrgsDelete},
	}); err != nil {
		t.Fatalf("create custom role: %v", err)
	}
	token := seedKeyV2(t, reg, "key-gd", "viewer", "team-gd")
	if err := reg.AddTeamMember(ctx, &registry.TeamMember{
		TeamID:  "team-gd",
		UserSub: "key-gd",
		RoleID:  "platform-ops",
	}); err != nil {
		t.Fatalf("add team member: %v", err)
	}

	srv := server.New(reg, server.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/gdpr/erasure",
		strings.NewReader(`{"subject_type":"api_key","subject_identifier":"abc123def456","reason":"test"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	// Handler returns 402 (no GDPR license in test), but NOT 403.
	if rec.Code == http.StatusForbidden {
		t.Fatalf("key with platform:orgs:delete on POST /gdpr/erasure got 403; body=%s",
			rec.Body.String())
	}
}

// TestRBACv2_H_GDPRErase_InsufficientPerm: viewer key without platform:orgs:delete → 403.
func TestRBACv2_H_GDPRErase_InsufficientPerm(t *testing.T) {
	reg := newReg(t)
	token := seedKeyV2(t, reg, "key-gd-noperm", "viewer", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/gdpr/erasure",
		strings.NewReader(`{"subject_type":"api_key","subject_identifier":"abc123","reason":"sneak"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer key on POST /gdpr/erasure got %d, want 403; body=%s",
			rec.Code, rec.Body.String())
	}
}

// TestRBACv2_H_GDPRErase_PlatformAdmin: admin key always passes (IsPlatformAdmin bypass).
func TestRBACv2_H_GDPRErase_PlatformAdmin(t *testing.T) {
	reg := newReg(t)
	token := seedKeyV2(t, reg, "key-gd-admin", "admin", "")
	srv := server.New(reg, server.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/gdpr/erasure",
		strings.NewReader(`{"subject_type":"api_key","subject_identifier":"aabbccdd","reason":"admin test"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("admin key on POST /gdpr/erasure got 403; body=%s", rec.Body.String())
	}
}
