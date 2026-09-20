package config_test

import (
	"testing"

	"github.com/purser/purser/go/controlplane/config"
)

// TestLocalAuthYAML verifies that the localAuth block unmarshals its username.
// The master password is intentionally NOT a YAML field (env-only), so only the
// username round-trips through purser.yaml.
func TestLocalAuthYAML(t *testing.T) {
	const yamlDoc = `
apiVersion: purser/v1
kind: ClusterConfig
metadata:
  name: test-cluster
cluster:
  id: test-cluster-01
localAuth:
  username: root
`
	c, err := config.Load([]byte(yamlDoc))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if c.LocalAuth == nil {
		t.Fatalf("LocalAuth = nil, want non-nil")
	}
	if c.LocalAuth.Username != "root" {
		t.Errorf("LocalAuth.Username = %q, want %q", c.LocalAuth.Username, "root")
	}
}

// TestLocalAuthYAML_Absent verifies that a config without a localAuth block
// leaves LocalAuth nil (the account is disabled by default).
func TestLocalAuthYAML_Absent(t *testing.T) {
	const yamlDoc = `
apiVersion: purser/v1
kind: ClusterConfig
metadata:
  name: test-cluster
cluster:
  id: test-cluster-01
`
	c, err := config.Load([]byte(yamlDoc))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if c.LocalAuth != nil {
		t.Errorf("LocalAuth = %+v, want nil when absent", c.LocalAuth)
	}
}
