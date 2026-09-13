package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/purser/purser/go/controlplane/registry"
	"github.com/purser/purser/go/controlplane/server"
)

func newTestServer(t *testing.T) (*server.Server, registry.Registry) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "registry.db")
	reg, err := registry.Open(dbPath)
	if err != nil {
		t.Fatalf("open registry: %v", err)
	}
	if err := reg.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { reg.Close() })
	return server.New(reg, server.Config{Addr: ":0"}), reg
}

func TestHandleListNodes(t *testing.T) {
	srv, reg := newTestServer(t)

	if err := reg.CreateNode(context.Background(), &registry.Node{
		ID:       "node-a",
		Hostname: "host-a",
		State:    "NODE_STATE_READY",
	}); err != nil {
		t.Fatalf("seed node: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}

	var body struct {
		Nodes []*registry.Node `json:"nodes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	if len(body.Nodes) != 1 {
		t.Fatalf("nodes len = %d, want 1", len(body.Nodes))
	}
	if body.Nodes[0].ID != "node-a" || body.Nodes[0].Hostname != "host-a" {
		t.Errorf("unexpected node: %+v", body.Nodes[0])
	}
}

func TestHandleListNodesEmpty(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// nodes must serialize as [] (not null) when empty.
	var body struct {
		Nodes []*registry.Node `json:"nodes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Nodes == nil {
		t.Errorf("nodes should be [] not null; raw=%s", rec.Body.String())
	}
}

func TestHandleClusterHealth(t *testing.T) {
	srv, reg := newTestServer(t)
	ctx := context.Background()
	_ = reg.CreateNode(ctx, &registry.Node{ID: "n1", State: "NODE_STATE_READY"})
	_ = reg.CreateNode(ctx, &registry.Node{ID: "n2", State: "NODE_STATE_DRAINING"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var h server.ClusterHealth
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.TotalNodes != 2 || h.ReadyNodes != 1 {
		t.Errorf("health counts: total=%d ready=%d, want 2/1", h.TotalNodes, h.ReadyNodes)
	}
	if h.Status != "ok" {
		t.Errorf("status = %q, want ok", h.Status)
	}
}

// TestHandleClusterHealth_RAMVRAMAggregation verifies that /cluster/health
// sums RAM and VRAM from READY/RUNNING nodes and excludes decommissioned ones.
// Regression test for H2: meters showed 0/0 GB because these fields were absent.
func TestHandleClusterHealth_RAMVRAMAggregation(t *testing.T) {
	srv, reg := newTestServer(t)
	ctx := context.Background()

	// Two READY nodes with known hardware — totals must be exact.
	_ = reg.CreateNode(ctx, &registry.Node{ID: "n1", State: "NODE_STATE_READY", RAMGB: 15.37, VRAMGB: 0})
	_ = reg.CreateNode(ctx, &registry.Node{ID: "n2", State: "NODE_STATE_RUNNING", RAMGB: 15.37, VRAMGB: 0})
	// Decommissioned node must NOT contribute to capacity.
	_ = reg.CreateNode(ctx, &registry.Node{ID: "n3", State: "NODE_STATE_DECOMMISSIONED", RAMGB: 64, VRAMGB: 24})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var h server.ClusterHealth
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Only n1+n2 contribute: 15.37 + 15.37 = 30.74 GB RAM.
	const wantRAM = 30.74
	if h.RAMTotalGB < wantRAM-0.01 || h.RAMTotalGB > wantRAM+0.01 {
		t.Errorf("ram_total_gb = %v, want ~%v (decommissioned node must not count)", h.RAMTotalGB, wantRAM)
	}
	// CPU-only cluster: VRAM=0 is the real measured value.
	if h.VRAMTotalGB != 0 {
		t.Errorf("vram_total_gb = %v, want 0 (CPU-only nodes)", h.VRAMTotalGB)
	}
	if h.ReadyNodes != 2 {
		t.Errorf("ready_nodes = %d, want 2", h.ReadyNodes)
	}
	if h.TotalNodes != 3 {
		t.Errorf("total_nodes = %d, want 3", h.TotalNodes)
	}
}

// TestHandleClusterHealth_GPUCluster ensures vram_total_gb carries real GPU
// VRAM when nodes have GPUs (not treated as "not measured").
func TestHandleClusterHealth_GPUCluster(t *testing.T) {
	srv, reg := newTestServer(t)
	ctx := context.Background()

	_ = reg.CreateNode(ctx, &registry.Node{ID: "g1", State: "NODE_STATE_READY", RAMGB: 128, VRAMGB: 24})
	_ = reg.CreateNode(ctx, &registry.Node{ID: "g2", State: "NODE_STATE_READY", RAMGB: 128, VRAMGB: 24})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	var h server.ClusterHealth
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.RAMTotalGB != 256 {
		t.Errorf("ram_total_gb = %v, want 256", h.RAMTotalGB)
	}
	if h.VRAMTotalGB != 48 {
		t.Errorf("vram_total_gb = %v, want 48", h.VRAMTotalGB)
	}
}
