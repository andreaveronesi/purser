// ---------------------------------------------------------------------------
// Tests for mock/backend.ts — the in-memory PurserApi implementation.
//
// Strategy:
// - vi.useFakeTimers() prevents real wall-clock waits from the delay() helper.
// - Module-level mutable state is shared across tests in this file (fresh per
//   test FILE in vitest's default isolation). Tests are ordered to respect
//   the accumulated state; read-only tests run first, mutations later.
// - Initial state: 5 nodes from mockNodes, 3 apiKeys, 1 deployment
//   ('dep-qwen3-moe', state='active').
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockBackend, NotFoundError } from '../backend';
import type { CreateRoleInput, UpdateRoleInput } from '../../api/client';

// Helper: fire all pending timers and await resolution
async function flush<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------

describe('NotFoundError', () => {
  it('is an instance of Error', () => {
    const e = new NotFoundError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// getCapacity
// ---------------------------------------------------------------------------

describe('mockBackend.getCapacity', () => {
  it('returns ClusterCapacity with nodeCount >= 0', async () => {
    const cap = await flush(mockBackend.getCapacity());
    expect(typeof cap.nodeCount).toBe('number');
    expect(cap.nodeCount).toBeGreaterThan(0);
    expect(typeof cap.readyNodeCount).toBe('number');
    expect(typeof cap.vramTotalGb).toBe('number');
    expect(typeof cap.gpuCount).toBe('number');
    expect(Array.isArray(cap.backends)).toBe(true);
    expect(typeof cap.fp4Capable).toBe('boolean');
    expect(typeof cap.aggregateDecodeTokS).toBe('number');
  });

  it('readyNodeCount <= nodeCount', async () => {
    const cap = await flush(mockBackend.getCapacity());
    expect(cap.readyNodeCount).toBeLessThanOrEqual(cap.nodeCount);
  });
});

// ---------------------------------------------------------------------------
// listNodes / getNode
// ---------------------------------------------------------------------------

describe('mockBackend.listNodes', () => {
  it('returns an array of nodes', async () => {
    const nodes = await flush(mockBackend.listNodes());
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('each node has a profile.nodeId string', async () => {
    const nodes = await flush(mockBackend.listNodes());
    for (const n of nodes) {
      expect(typeof n.profile.nodeId).toBe('string');
      expect(n.profile.nodeId.length).toBeGreaterThan(0);
    }
  });

  it('returns a deep clone (mutations do not affect internal state)', async () => {
    const nodes = await flush(mockBackend.listNodes());
    const before = nodes[0].profile.hostname;
    nodes[0].profile.hostname = 'mutated';
    const nodes2 = await flush(mockBackend.listNodes());
    expect(nodes2[0].profile.hostname).toBe(before);
  });
});

describe('mockBackend.getNode', () => {
  it('returns the correct node by id', async () => {
    const all = await flush(mockBackend.listNodes());
    const first = all[0];
    const node = await flush(mockBackend.getNode(first.profile.nodeId));
    expect(node.profile.nodeId).toBe(first.profile.nodeId);
  });

  it('throws NotFoundError synchronously for unknown nodeId', () => {
    expect(() => mockBackend.getNode('does-not-exist')).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// drainNode / restartNode
// ---------------------------------------------------------------------------

describe('mockBackend.drainNode', () => {
  it('sets node state to draining and clears role', async () => {
    const all = await flush(mockBackend.listNodes());
    // Use the rtx node which is 'ready' (doesn't have an active deployment role)
    const target = all.find((n) => n.profile.state === 'ready');
    expect(target).toBeDefined();
    const drained = await flush(mockBackend.drainNode(target!.profile.nodeId));
    expect(drained.profile.state).toBe('draining');
    expect(drained.role).toBeNull();
  });

  it('throws NotFoundError synchronously for unknown nodeId', () => {
    expect(() => mockBackend.drainNode('ghost-node')).toThrow(NotFoundError);
  });
});

describe('mockBackend.restartNode', () => {
  it('sets state to ready, clears metrics/role/deploymentId', async () => {
    const all = await flush(mockBackend.listNodes());
    // Use a node in draining or degraded state
    const target = all.find((n) =>
      n.profile.state === 'draining' || n.profile.state === 'ready',
    );
    expect(target).toBeDefined();
    const restarted = await flush(mockBackend.restartNode(target!.profile.nodeId));
    expect(restarted.profile.state).toBe('ready');
    expect(restarted.metrics).toBeNull();
    expect(restarted.role).toBeNull();
    expect(restarted.deploymentId).toBeNull();
  });

  it('throws NotFoundError synchronously for unknown nodeId', () => {
    expect(() => mockBackend.restartNode('ghost-node')).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getCatalog / getModel
// ---------------------------------------------------------------------------

describe('mockBackend.getCatalog', () => {
  it('returns an array of CatalogEntry objects', async () => {
    const catalog = await flush(mockBackend.getCatalog());
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('each entry has a model and a fit verdict', async () => {
    const catalog = await flush(mockBackend.getCatalog());
    for (const entry of catalog) {
      expect(entry.model).toBeDefined();
      expect(typeof entry.model.modelId).toBe('string');
      expect(entry.fit).toBeDefined();
      expect(typeof entry.fit.fits).toBe('boolean');
    }
  });
});

describe('mockBackend.getModel', () => {
  it('returns the correct model for a known modelId', async () => {
    const catalog = await flush(mockBackend.getCatalog());
    const id = catalog[0].model.modelId;
    const model = await flush(mockBackend.getModel(id));
    expect(model.modelId).toBe(id);
  });

  it('throws NotFoundError synchronously for unknown modelId', () => {
    expect(() => mockBackend.getModel('no-such-model')).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// importModel / deleteModel
// ---------------------------------------------------------------------------

describe('mockBackend.importModel', () => {
  it('returns a ModelSpec with a modelId', async () => {
    const source = { type: 'huggingface' as const, repo: 'meta-llama/Llama-3.1-8B' };
    const model = await flush(mockBackend.importModel(source));
    expect(model.modelId).toBeDefined();
    expect(Array.isArray(model.quantizations)).toBe(true);
  });

  it('does not create duplicates when same source imported twice', async () => {
    const source = { type: 'sagemaker' as const, modelGroup: 'mistral-7b' };
    await flush(mockBackend.importModel(source));
    await flush(mockBackend.importModel(source));
    const catalog = await flush(mockBackend.getCatalog());
    // Count entries for this modelId
    const sm = catalog.filter((e) => e.model.modelId === 'sm:mistral-7b-instruct');
    expect(sm).toHaveLength(1);
  });
});

describe('mockBackend.deleteModel', () => {
  it('removes an imported model successfully', async () => {
    // Import first
    const source = { type: 'vertexai' as const, modelPath: 'projects/p/models/gemini-nano' };
    const imported = await flush(mockBackend.importModel(source));
    const catalog1 = await flush(mockBackend.getCatalog());
    const before = catalog1.some((e) => e.model.modelId === imported.modelId);
    expect(before).toBe(true);

    // Delete
    await flush(mockBackend.deleteModel(imported.modelId));

    const catalog2 = await flush(mockBackend.getCatalog());
    const after = catalog2.some((e) => e.model.modelId === imported.modelId);
    expect(after).toBe(false);
  });

  it('throws NotFoundError synchronously for unknown modelId', () => {
    expect(() => mockBackend.deleteModel('not-a-real-model')).toThrow(NotFoundError);
  });

  it('rejects with ApiError(409) when an active deployment uses the model', async () => {
    // 'qwen3-moe-235b' has an active deployment seeded at startup
    await expect(mockBackend.deleteModel('qwen3-moe-235b')).rejects.toMatchObject({
      status: 409,
    });
  });
});

// ---------------------------------------------------------------------------
// previewModelPlan
// ---------------------------------------------------------------------------

describe('mockBackend.previewModelPlan', () => {
  it('returns a PlanPreviewResult for a known model', async () => {
    const result = await flush(mockBackend.previewModelPlan('phi4-14b'));
    expect(typeof result.feasible).toBe('boolean');
  });

  it('throws NotFoundError synchronously for unknown modelId', () => {
    expect(() => mockBackend.previewModelPlan('no-such')).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getModelHealth
// ---------------------------------------------------------------------------

describe('mockBackend.getModelHealth', () => {
  it('returns healthy for a model with an active deployment', async () => {
    const health = await flush(mockBackend.getModelHealth('qwen3-moe-235b'));
    expect(health.modelId).toBe('qwen3-moe-235b');
    expect(health.status).toBe('healthy');
    expect(health.deploymentId.length).toBeGreaterThan(0);
    expect(health.nodeCount).toBeGreaterThan(0);
  });

  it('returns unavailable for a model with no deployment', async () => {
    const health = await flush(mockBackend.getModelHealth('phi4-14b'));
    expect(health.modelId).toBe('phi4-14b');
    expect(health.status).toBe('unavailable');
    expect(health.errorMessage).toBeDefined();
  });

  it('returns degraded for a model with a provisioning deployment (line 309 branch)', async () => {
    // Create a deployment in 'provisioning' state — covers the
    // `else if (state === 'provisioning' || state === 'stopping') status = 'degraded'` branch
    await flush(
      mockBackend.createDeployment('mixtral-8x22b', { forceNodeCount: 1, preference: 'speed' }),
    );
    const health = await flush(mockBackend.getModelHealth('mixtral-8x22b'));
    expect(health.status).toBe('degraded');
    expect(health.deploymentState).toBe('provisioning');
    expect(health.nodeCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// planDeployment / createDeployment / listDeployments / getDeployment / undeploy
// ---------------------------------------------------------------------------

describe('mockBackend.planDeployment', () => {
  it('returns a DeploymentPlan with assignments and planId', async () => {
    const plan = await flush(
      mockBackend.planDeployment('phi4-14b', { forceNodeCount: null, preference: 'balanced' }),
    );
    expect(plan.planId).toMatch(/^plan-phi4-14b-/);
    expect(plan.modelId).toBe('phi4-14b');
    expect(Array.isArray(plan.assignments)).toBe(true);
    expect(plan.assignments.length).toBeGreaterThan(0);
  });

  it('throws NotFoundError synchronously for unknown modelId', () => {
    expect(() =>
      mockBackend.planDeployment('no-model', { forceNodeCount: null, preference: 'balanced' }),
    ).toThrow(NotFoundError);
  });
});

describe('mockBackend.createDeployment', () => {
  it('creates a deployment in provisioning state', async () => {
    const dep = await flush(
      mockBackend.createDeployment('phi4-14b', { forceNodeCount: null, preference: 'balanced' }),
    );
    expect(dep.state).toBe('provisioning');
    expect(dep.plan.modelId).toBe('phi4-14b');
    expect(dep.nodeStatus.length).toBeGreaterThan(0);
  });

  it('all nodeStatus entries start as loading with progress=0', async () => {
    const dep = await flush(
      mockBackend.createDeployment('mixtral-8x22b', { forceNodeCount: null, preference: 'balanced' }),
    );
    for (const ns of dep.nodeStatus) {
      expect(ns.state).toBe('loading');
      expect(ns.progress).toBe(0);
    }
  });

  it('throws NotFoundError synchronously for unknown modelId', () => {
    expect(() =>
      mockBackend.createDeployment('ghost', { forceNodeCount: null, preference: 'balanced' }),
    ).toThrow(NotFoundError);
  });
});

describe('mockBackend.listDeployments', () => {
  it('returns an array of deployments', async () => {
    const deps = await flush(mockBackend.listDeployments());
    expect(Array.isArray(deps)).toBe(true);
    expect(deps.length).toBeGreaterThan(0);
  });

  it('seeded deployment dep-qwen3-moe is present and active', async () => {
    const deps = await flush(mockBackend.listDeployments());
    const seeded = deps.find((d) => d.id === 'dep-qwen3-moe');
    expect(seeded).toBeDefined();
    expect(seeded!.state).toBe('active');
  });
});

describe('mockBackend.getDeployment', () => {
  it('returns the deployment by id', async () => {
    const dep = await flush(mockBackend.getDeployment('dep-qwen3-moe'));
    expect(dep.id).toBe('dep-qwen3-moe');
  });

  it('throws NotFoundError synchronously for unknown id', () => {
    expect(() => mockBackend.getDeployment('dep-ghost')).toThrow(NotFoundError);
  });

  it('active deployments return state=active immediately', async () => {
    const dep = await flush(mockBackend.getDeployment('dep-qwen3-moe'));
    expect(dep.state).toBe('active');
    for (const ns of dep.nodeStatus) {
      expect(ns.state).toBe('running');
      expect(ns.progress).toBe(1);
    }
  });
});

describe('mockBackend.undeployDeployment', () => {
  it('removes the deployment and the deployment is no longer findable', async () => {
    // Create a fresh deployment to undeploy
    const dep = await flush(
      mockBackend.createDeployment('llama3.1-70b', { forceNodeCount: null, preference: 'balanced' }),
    );
    const id = dep.id;

    // Verify it exists
    const found = await flush(mockBackend.getDeployment(id));
    expect(found.id).toBe(id);

    // Undeploy
    await flush(mockBackend.undeployDeployment(id));

    // Should be gone — getDeployment throws synchronously after undeploy
    expect(() => mockBackend.getDeployment(id)).toThrow(NotFoundError);
  });

  it('throws NotFoundError synchronously for unknown deployment id', () => {
    expect(() => mockBackend.undeployDeployment('dep-ghost')).toThrow(NotFoundError);
  });

  it('releases the nodes (clears deploymentId) after undeploy', async () => {
    // Create deployment
    const dep = await flush(
      mockBackend.createDeployment('phi4-14b', { forceNodeCount: 1, preference: 'speed' }),
    );
    const assignedNodeId = dep.nodeStatus[0].nodeId;
    await flush(mockBackend.undeployDeployment(dep.id));

    // The node should no longer reference this deployment
    const nodes = await flush(mockBackend.listNodes());
    const freed = nodes.find((n) => n.profile.nodeId === assignedNodeId);
    if (freed) {
      expect(freed.deploymentId).not.toBe(dep.id);
    }
  });
});

// ---------------------------------------------------------------------------
// getPlan
// ---------------------------------------------------------------------------

describe('mockBackend.getPlan', () => {
  it('returns a plan that was previously created', async () => {
    const plan = await flush(
      mockBackend.planDeployment('phi4-14b', { forceNodeCount: null, preference: 'balanced' }),
    );
    const retrieved = await flush(mockBackend.getPlan(plan.planId));
    expect(retrieved.planId).toBe(plan.planId);
    expect(retrieved.modelId).toBe('phi4-14b');
  });

  it('throws NotFoundError synchronously for unknown planId', () => {
    expect(() => mockBackend.getPlan('plan-nonexistent')).toThrow(NotFoundError);
  });

  it('can retrieve the plan embedded in a live deployment', async () => {
    const dep = await flush(mockBackend.getDeployment('dep-qwen3-moe'));
    const planId = dep.plan.planId;
    const plan = await flush(mockBackend.getPlan(planId));
    expect(plan.planId).toBe(planId);
  });
});

// ---------------------------------------------------------------------------
// JoinInfo / tokens
// ---------------------------------------------------------------------------

describe('mockBackend.getJoinInfo', () => {
  it('returns a JoinInfo with joinToken and controlPlaneUrl', async () => {
    const info = await flush(mockBackend.getJoinInfo());
    expect(info.joinToken).toMatch(/^prsr_join_/);
    expect(info.controlPlaneUrl).toMatch(/https?:\/\//);
    expect(typeof info.expiresAt).toBe('string');
  });
});

describe('mockBackend.rotateJoinToken', () => {
  it('returns a new token different from the current one', async () => {
    const before = await flush(mockBackend.getJoinInfo());
    const after = await flush(mockBackend.rotateJoinToken());
    expect(after.joinToken).not.toBe(before.joinToken);
    expect(after.joinToken).toMatch(/^prsr_join_/);
  });

  it('new token has a future expiry', async () => {
    const after = await flush(mockBackend.rotateJoinToken());
    expect(new Date(after.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('mockBackend.createJoinToken', () => {
  it('returns a JoinTokenResult with a token and clusterId', async () => {
    const result = await flush(mockBackend.createJoinToken(3600));
    expect(result.token).toMatch(/^prsr_join_/);
    expect(typeof result.clusterId).toBe('string');
    expect(typeof result.expiresAt).toBe('string');
  });

  it('expiry is approximately ttlSeconds in the future', async () => {
    const before = Date.now();
    const result = await flush(mockBackend.createJoinToken(3600));
    const expiresMs = new Date(result.expiresAt).getTime();
    // Allow 1 second tolerance
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3599 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(before + 3601 * 1000);
  });
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

describe('mockBackend.listApiKeys', () => {
  it('returns an array of API keys', async () => {
    const keys = await flush(mockBackend.listApiKeys());
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('each key has id, name, prefix, role, revoked', async () => {
    const keys = await flush(mockBackend.listApiKeys());
    for (const k of keys) {
      expect(typeof k.id).toBe('string');
      expect(typeof k.name).toBe('string');
      expect(k.prefix).toMatch(/^sk-purser-/);
      expect(typeof k.revoked).toBe('boolean');
    }
  });
});

describe('mockBackend.createApiKey', () => {
  it('creates a new key and returns it with a secret', async () => {
    const result = await flush(
      mockBackend.createApiKey({ name: 'test-key', team: 'engineering', role: 'inference', monthlyQuota: 10000 }),
    );
    expect(result.name).toBe('test-key');
    expect(result.team).toBe('engineering');
    expect(result.role).toBe('inference');
    expect(typeof result.secret).toBe('string');
    expect(result.secret.length).toBeGreaterThan(0);
    expect(result.revoked).toBe(false);
    expect(result.usedThisMonth).toBe(0);
  });

  it('defaults role to admin when not provided', async () => {
    const result = await flush(
      mockBackend.createApiKey({ name: 'admin-key', team: 'ops', monthlyQuota: null }),
    );
    expect(result.role).toBe('admin');
  });

  it('new key appears in listApiKeys', async () => {
    const created = await flush(
      mockBackend.createApiKey({ name: 'listing-check', team: 'qa', role: 'viewer', monthlyQuota: null }),
    );
    const keys = await flush(mockBackend.listApiKeys());
    const found = keys.find((k) => k.id === created.id);
    expect(found).toBeDefined();
  });
});

describe('mockBackend.revokeApiKey', () => {
  it('sets revoked=true on the key', async () => {
    const created = await flush(
      mockBackend.createApiKey({ name: 'to-revoke', team: 'test', role: 'inference', monthlyQuota: null }),
    );
    const revoked = await flush(mockBackend.revokeApiKey(created.id));
    expect(revoked.revoked).toBe(true);
  });

  it('throws NotFoundError synchronously for unknown key id', () => {
    expect(() => mockBackend.revokeApiKey('key_ghost')).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

describe('mockBackend.getKeyUsage', () => {
  it('returns usage stats for a known key id', async () => {
    const keys = await flush(mockBackend.listApiKeys());
    const id = keys[0].id;
    const usage = await flush(mockBackend.getKeyUsage(id));
    expect(usage.apiKeyId).toBe(id);
    expect(typeof usage.totalRequests).toBe('number');
    expect(typeof usage.inputTokens).toBe('number');
    expect(typeof usage.outputTokens).toBe('number');
  });

  it('usage is deterministic — same key returns same counts', async () => {
    const keys = await flush(mockBackend.listApiKeys());
    const id = keys[0].id;
    const u1 = await flush(mockBackend.getKeyUsage(id));
    const u2 = await flush(mockBackend.getKeyUsage(id));
    expect(u1.totalRequests).toBe(u2.totalRequests);
    expect(u1.inputTokens).toBe(u2.inputTokens);
  });

  it('throws NotFoundError synchronously for unknown key id', () => {
    expect(() => mockBackend.getKeyUsage('key_ghost')).toThrow(NotFoundError);
  });
});

describe('mockBackend.getUsageSummary', () => {
  it('returns tenants array with usage data', async () => {
    const summary = await flush(mockBackend.getUsageSummary());
    expect(Array.isArray(summary.tenants)).toBe(true);
    for (const t of summary.tenants) {
      expect(typeof t.tenant).toBe('string');
      expect(typeof t.totalRequests).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// Enterprise / audit
// ---------------------------------------------------------------------------

describe('mockBackend.getEnterpriseStatus', () => {
  it('returns community edition in mock mode', async () => {
    const status = await flush(mockBackend.getEnterpriseStatus());
    expect(status.edition).toBe('community');
    expect(Array.isArray(status.features)).toBe(true);
  });
});

describe('mockBackend.getAuditLog', () => {
  it('returns audit entries with correct structure', async () => {
    const log = await mockBackend.getAuditLog(); // async function, no delay()
    expect(log.feature).toBe('audit');
    expect(Array.isArray(log.entries)).toBe(true);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.chain.verified).toBe(true);
    expect(log.chain.length).toBe(log.entries.length);
  });

  it('limits entries when limit parameter is provided', async () => {
    const log2 = await mockBackend.getAuditLog(2);
    expect(log2.entries.length).toBeLessThanOrEqual(2);
  });

  it('entries have sequential seq numbers starting at 1', async () => {
    const log = await mockBackend.getAuditLog();
    for (let i = 0; i < log.entries.length; i++) {
      expect(log.entries[i].seq).toBe(i + 1);
    }
  });

  it('each entry has hash and prevHash fields', async () => {
    const log = await mockBackend.getAuditLog();
    for (const e of log.entries) {
      expect(typeof e.hash).toBe('string');
      expect(typeof e.prevHash).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Enterprise-gated features (reject with 402)
// ---------------------------------------------------------------------------

// Enterprise-gated operations return Promise.reject immediately (no delay)
describe('enterprise-gated operations', () => {
  it('listDeploymentApprovals rejects with status 402', async () => {
    await expect(mockBackend.listDeploymentApprovals()).rejects.toMatchObject({ status: 402 });
  });

  it('getDeploymentApproval rejects with status 402', async () => {
    await expect(mockBackend.getDeploymentApproval('dep')).rejects.toMatchObject({ status: 402 });
  });

  it('approveDeployment rejects with status 402', async () => {
    await expect(mockBackend.approveDeployment('dep')).rejects.toMatchObject({ status: 402 });
  });

  it('rejectDeployment rejects with status 402', async () => {
    await expect(mockBackend.rejectDeployment('dep')).rejects.toMatchObject({ status: 402 });
  });

  it('getBillingReport rejects with status 402', async () => {
    await expect(mockBackend.getBillingReport('2024-01', '2024-12')).rejects.toMatchObject({ status: 402 });
  });

  it('getModelAdoption rejects with status 402', async () => {
    await expect(mockBackend.getModelAdoption()).rejects.toMatchObject({ status: 402 });
  });

  it('getOrgBilling rejects with status 402', async () => {
    await expect(mockBackend.getOrgBilling('org', '2024-01', '2024-12')).rejects.toMatchObject({ status: 402 });
  });

  it('getTeamBilling rejects with status 402', async () => {
    await expect(mockBackend.getTeamBilling('org', 'team', 'period')).rejects.toMatchObject({ status: 402 });
  });
});

// ---------------------------------------------------------------------------
// Billing URLs and summary
// ---------------------------------------------------------------------------

describe('billing URLs', () => {
  it('getBillingCsvUrl returns a data: URL', () => {
    const url = mockBackend.getBillingCsvUrl('2024-01', '2024-12');
    expect(url).toMatch(/^data:/);
  });

  it('getBillingXlsxUrl returns a data: URL', () => {
    const url = mockBackend.getBillingXlsxUrl('2024-01', '2024-12');
    expect(url).toMatch(/^data:/);
  });

  it('getBillingPdfUrl returns a data: URL', () => {
    const url = mockBackend.getBillingPdfUrl('2024-01', '2024-12');
    expect(url).toMatch(/^data:/);
  });
});

describe('mockBackend.getBillingSummary', () => {
  it('returns a billing summary with zero totals in mock mode', async () => {
    const summary = await mockBackend.getBillingSummary();
    expect(typeof summary.total_requests).toBe('number');
    expect(typeof summary.total_tokens).toBe('number');
    expect(summary.total_requests).toBe(0);
    expect(summary.total_tokens).toBe(0);
    expect(summary.active_tenants).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// streamMetrics
// ---------------------------------------------------------------------------

describe('mockBackend.streamMetrics', () => {
  it('calls onMetrics immediately on start', () => {
    const onMetrics = vi.fn();
    const stop = mockBackend.streamMetrics({ onMetrics });
    expect(onMetrics).toHaveBeenCalledOnce();
    stop();
  });

  it('calls onMetrics again after interval tick', () => {
    const onMetrics = vi.fn();
    const stop = mockBackend.streamMetrics({ onMetrics });
    vi.advanceTimersByTime(1500);
    expect(onMetrics.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('returned stop function cancels further emissions', () => {
    const onMetrics = vi.fn();
    const stop = mockBackend.streamMetrics({ onMetrics });
    stop();
    const callsAtStop = onMetrics.mock.calls.length;
    vi.advanceTimersByTime(5000);
    // No additional calls after stop
    expect(onMetrics.mock.calls.length).toBe(callsAtStop);
  });

  it('emitted snapshot has correct shape', () => {
    const onMetrics = vi.fn();
    const stop = mockBackend.streamMetrics({ onMetrics });
    const snapshot = onMetrics.mock.calls[0][0] as ReturnType<typeof onMetrics>['mock']['calls'][0][0];
    expect(typeof snapshot.at).toBe('string');
    expect(typeof snapshot.aggregateDecodeTokS).toBe('number');
    expect(Array.isArray(snapshot.nodes)).toBe(true);
    stop();
  });

  it('abort signal stops emissions', () => {
    const controller = new AbortController();
    const onMetrics = vi.fn();
    mockBackend.streamMetrics({ onMetrics, signal: controller.signal });
    controller.abort();
    const callsAtAbort = onMetrics.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(onMetrics.mock.calls.length).toBe(callsAtAbort);
  });
});

// ---------------------------------------------------------------------------
// RBAC — listRoles / createRole / getRole / updateRole / deleteRole
// ---------------------------------------------------------------------------

describe('mockBackend.listRoles', () => {
  it('includes system roles', async () => {
    const resp = await flush(mockBackend.listRoles('test-org'));
    const systemRole = resp.roles.find((r) => r.isSystem);
    expect(systemRole).toBeDefined();
  });

  it('system roles include org_admin and team_admin', async () => {
    const resp = await flush(mockBackend.listRoles('test-org'));
    const ids = resp.roles.filter((r) => r.isSystem).map((r) => r.id);
    expect(ids).toContain('org_admin');
    expect(ids).toContain('team_admin');
  });
});

describe('mockBackend.createRole', () => {
  it('creates a custom role with the given name and permissions', async () => {
    const role = await flush(
      mockBackend.createRole('my-org', { name: 'custom-analyst', permissions: ['team:metrics:view'], description: 'Analyst' }),
    );
    expect(role.name).toBe('custom-analyst');
    expect(role.permissions).toContain('team:metrics:view');
    expect(role.isSystem).toBe(false);
    expect(role.orgId).toBe('my-org');
  });

  it('rejects with 409 when role name duplicates a system role', async () => {
    // Promise.reject(ApiError) — no delay needed
    await expect(
      mockBackend.createRole('any-org', { name: 'Organization Administrator', permissions: [] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects with 409 when role name duplicates an existing custom role', async () => {
    const name = `dupe-test-${Date.now()}`;
    await flush(mockBackend.createRole('my-org', { name, permissions: [] }));
    // Promise.reject(ApiError) — no delay needed
    await expect(
      mockBackend.createRole('my-org', { name, permissions: [] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('new role appears in listRoles for the same org', async () => {
    const role = await flush(
      mockBackend.createRole('list-check-org', { name: 'my-new-role', permissions: [] }),
    );
    const resp = await flush(mockBackend.listRoles('list-check-org'));
    const found = resp.roles.find((r) => r.id === role.id);
    expect(found).toBeDefined();
  });
});

describe('mockBackend.getRole', () => {
  it('returns a system role by id', async () => {
    const role = await flush(mockBackend.getRole('any-org', 'org_admin'));
    expect(role.id).toBe('org_admin');
    expect(role.isSystem).toBe(true);
  });

  it('throws NotFoundError synchronously for unknown role id', () => {
    expect(() => mockBackend.getRole('any-org', 'non-existent-id')).toThrow(NotFoundError);
  });

  it('returns a custom role that was created', async () => {
    const created = await flush(
      mockBackend.createRole('gettest-org', { name: 'gettest-role', permissions: ['inference:call'] }),
    );
    const fetched = await flush(mockBackend.getRole('gettest-org', created.id));
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('gettest-role');
  });
});

describe('mockBackend.updateRole', () => {
  it('updates the name and permissions of a custom role', async () => {
    const role = await flush(
      mockBackend.createRole('update-org', { name: 'to-update', permissions: [] }),
    );
    const updated = await flush(
      mockBackend.updateRole('update-org', role.id, { name: 'updated-name', permissions: ['inference:call'] }),
    );
    expect(updated.name).toBe('updated-name');
    expect(updated.permissions).toContain('inference:call');
  });

  it('rejects with 409 when trying to update a system role', async () => {
    // Returns Promise.reject(ApiError) synchronously — no need for flush
    await expect(
      mockBackend.updateRole('any-org', 'org_admin', { name: 'hacked', permissions: [] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('throws NotFoundError synchronously when role does not exist in the org', () => {
    expect(() =>
      mockBackend.updateRole('no-such-org', 'role-ghost', { name: 'x', permissions: [] }),
    ).toThrow(NotFoundError);
  });
});

describe('mockBackend.deleteRole', () => {
  it('removes the role so it no longer appears in listRoles', async () => {
    const role = await flush(
      mockBackend.createRole('del-org', { name: 'to-delete', permissions: [] }),
    );
    await flush(mockBackend.deleteRole('del-org', role.id));
    const resp = await flush(mockBackend.listRoles('del-org'));
    const found = resp.roles.find((r) => r.id === role.id);
    expect(found).toBeUndefined();
  });

  it('rejects with 409 when trying to delete a system role', async () => {
    // Returns Promise.reject(ApiError) synchronously — no need for flush
    await expect(
      mockBackend.deleteRole('any-org', 'viewer'),
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------
// listPermissions
// ---------------------------------------------------------------------------

describe('mockBackend.listPermissions', () => {
  it('returns a full permission catalog', async () => {
    const resp = await flush(mockBackend.listPermissions());
    expect(Array.isArray(resp.permissions)).toBe(true);
    // 22 permissions documented in the code
    expect(resp.permissions.length).toBe(22);
  });

  it('each permission has key, description, and scope', async () => {
    const resp = await flush(mockBackend.listPermissions());
    for (const p of resp.permissions) {
      expect(typeof p.key).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(['platform', 'org', 'team', 'inference']).toContain(p.scope);
    }
  });

  it('permission keys are unique', async () => {
    const resp = await flush(mockBackend.listPermissions());
    const keys = resp.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Inference audit / access log
// ---------------------------------------------------------------------------

describe('mockBackend.listInferenceAudit', () => {
  it('returns events array with seq, modelId, tenant fields', async () => {
    const resp = await flush(mockBackend.listInferenceAudit());
    expect(Array.isArray(resp.events)).toBe(true);
    for (const e of resp.events) {
      expect(typeof e.seq).toBe('number');
      expect(typeof e.modelId).toBe('string');
      expect(typeof e.tenant).toBe('string');
    }
  });

  it('filters by modelId', async () => {
    const resp = await flush(mockBackend.listInferenceAudit({ modelId: 'llama3-8b' }));
    for (const e of resp.events) {
      expect(e.modelId).toBe('llama3-8b');
    }
  });

  it('filters by tenant', async () => {
    const resp = await flush(mockBackend.listInferenceAudit({ tenant: 'acme' }));
    for (const e of resp.events) {
      expect(e.tenant).toBe('acme');
    }
  });

  it('respects limit and offset pagination', async () => {
    const full = await flush(mockBackend.listInferenceAudit({ limit: 100 }));
    const page1 = await flush(mockBackend.listInferenceAudit({ limit: 2, offset: 0 }));
    const page2 = await flush(mockBackend.listInferenceAudit({ limit: 2, offset: 2 }));
    expect(page1.events.length).toBeLessThanOrEqual(2);
    // page1 + page2 combined should not exceed full
    expect(page1.events.length + page2.events.length).toBeLessThanOrEqual(full.total);
  });

  it('total field reflects the unfiltered count', async () => {
    const resp = await flush(mockBackend.listInferenceAudit());
    expect(resp.total).toBe(resp.events.length);
  });
});

describe('mockBackend.verifyAuditChain', () => {
  it('returns verified=true with blockCount and lastVerifiedAt', async () => {
    const resp = await flush(mockBackend.verifyAuditChain());
    expect(resp.verified).toBe(true);
    expect(resp.blockCount).toBeGreaterThan(0);
    expect(typeof resp.lastVerifiedAt).toBe('string');
    expect(resp.brokenAtSeq).toBeNull();
  });
});

describe('mockBackend.listAccessLog', () => {
  it('returns entries with id, method, path, statusCode', async () => {
    const resp = await flush(mockBackend.listAccessLog());
    expect(Array.isArray(resp.entries)).toBe(true);
    for (const e of resp.entries) {
      expect(typeof e.id).toBe('number');
      expect(typeof e.method).toBe('string');
      expect(typeof e.path).toBe('string');
      expect(typeof e.statusCode).toBe('number');
    }
  });

  it('filters by apiKeyId when provided', async () => {
    const resp = await flush(mockBackend.listAccessLog({ apiKeyId: 'key-abc123' }));
    for (const e of resp.entries) {
      expect(e.apiKeyId).toBe('key-abc123');
    }
  });
});

// ---------------------------------------------------------------------------
// Org / Team / Pool stubs
// ---------------------------------------------------------------------------

describe('organization stubs', () => {
  it('listOrganizations returns empty array', async () => {
    const resp = await flush(mockBackend.listOrganizations());
    expect(resp.organizations).toEqual([]);
  });

  it('createOrganization returns an org with id, name, slug', async () => {
    const org = await flush(mockBackend.createOrganization({ name: 'Test Org', slug: 'test-org' }));
    expect(typeof org.id).toBe('string');
    expect(org.name).toBe('Test Org');
    expect(org.slug).toBe('test-org');
  });

  it('getOrganization returns an org with the given id', async () => {
    const org = await flush(mockBackend.getOrganization('my-org-id'));
    expect(org.id).toBe('my-org-id');
  });

  it('deleteOrganization resolves without throwing', async () => {
    await expect(flush(mockBackend.deleteOrganization('any-id'))).resolves.toBeUndefined();
  });
});

describe('team stubs', () => {
  it('listTeams returns empty teams array', async () => {
    const resp = await flush(mockBackend.listTeams('org-1'));
    expect(resp.teams).toEqual([]);
  });

  it('createTeam returns a team with org_id', async () => {
    const team = await flush(mockBackend.createTeam('org-1', { name: 'Dev', slug: 'dev' }));
    expect(team.org_id).toBe('org-1');
    expect(team.name).toBe('Dev');
  });

  it('addTeamMember returns a member with team_id', async () => {
    const member = await flush(mockBackend.addTeamMember('team-1', { user_id: 'user-1', role_id: 'viewer' }));
    expect(member.team_id).toBe('team-1');
    expect(typeof member.id).toBe('number');
  });
});

describe('node pool stubs', () => {
  it('listNodePools returns empty pools array', async () => {
    const resp = await flush(mockBackend.listNodePools());
    expect(resp.pools).toEqual([]);
  });

  it('createNodePool returns a pool with default values', async () => {
    const pool = await flush(mockBackend.createNodePool({ name: 'gpu-pool' }));
    expect(pool.name).toBe('gpu-pool');
    expect(typeof pool.id).toBe('string');
    expect(Array.isArray(pool.node_ids)).toBe(true);
  });

  it('upsertPoolQuota returns a quota with the provided values', async () => {
    const quota = await flush(
      mockBackend.upsertPoolQuota('pool-1', 'team-1', { max_deployments: 5, max_gpu_nodes: 2, priority: 3 }),
    );
    expect(quota.pool_id).toBe('pool-1');
    expect(quota.team_id).toBe('team-1');
    expect(quota.max_deployments).toBe(5);
    expect(quota.max_gpu_nodes).toBe(2);
    expect(quota.priority).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Misc stubs
// ---------------------------------------------------------------------------

describe('mockBackend.getReconcilerStatus', () => {
  it('returns a config with expected fields', async () => {
    const status = await flush(mockBackend.getReconcilerStatus());
    expect(typeof status.config.intervalS).toBe('number');
    expect(typeof status.config.nodeTimeoutS).toBe('number');
    expect(status.tracker).toBeDefined();
  });
});

describe('mockBackend.getClusterStatus', () => {
  it('returns standalone mode as leader', async () => {
    const status = await flush(mockBackend.getClusterStatus());
    expect(status.mode).toBe('standalone');
    expect(status.isLeader).toBe(true);
  });
});

describe('mockBackend.getMe', () => {
  it('returns actor, orgs, and teams', async () => {
    const me = await flush(mockBackend.getMe());
    expect(me.actor).toBe('mock-user');
    expect(Array.isArray(me.orgs)).toBe(true);
    expect(Array.isArray(me.teams)).toBe(true);
  });
});

describe('mockBackend.getMyTeamPermissions', () => {
  it('returns effective permissions with user_id and permissions array', async () => {
    const perms = await flush(mockBackend.getMyTeamPermissions('team-1'));
    expect(perms.user_id).toBe('mock-user');
    expect(perms.team_id).toBe('team-1');
    expect(Array.isArray(perms.permissions)).toBe(true);
  });
});

describe('mockBackend.whatIfPlan', () => {
  it('returns infeasible with reason in mock mode', async () => {
    const result = await flush(mockBackend.whatIfPlan({ model_id: 'qwen3-moe-235b', hypothetical_nodes: [], include_existing_nodes: false }));
    expect(result.feasible).toBe(false);
    expect(typeof result.reason).toBe('string');
  });
});

describe('mockBackend.getSloComplianceFull', () => {
  it('returns models array (empty in mock)', async () => {
    const resp = await flush(mockBackend.getSloComplianceFull(24));
    expect(resp.window_hours).toBe(24);
    expect(Array.isArray(resp.models)).toBe(true);
  });
});

describe('mockBackend.getBillingForecast', () => {
  it('returns entries array (empty in mock)', async () => {
    const resp = await flush(mockBackend.getBillingForecast());
    expect(Array.isArray(resp.entries)).toBe(true);
  });
});

describe('policy stubs', () => {
  it('listPolicies returns empty policies array', async () => {
    const resp = await flush(mockBackend.listPolicies());
    expect(resp.policies).toEqual([]);
  });

  it('upsertPolicy returns the policy with name and source', async () => {
    const policy = await flush(mockBackend.upsertPolicy('deny-all', 'package main\ndeny = true', true));
    expect(policy.name).toBe('deny-all');
    expect(policy.source).toBe('package main\ndeny = true');
    expect(policy.enabled).toBe(true);
  });

  it('deletePolicy resolves without throwing', async () => {
    await expect(flush(mockBackend.deletePolicy('deny-all'))).resolves.toBeUndefined();
  });
});

describe('config-as-code stubs', () => {
  it('exportConfig returns a YAML string', async () => {
    const yaml = await flush(mockBackend.exportConfig());
    expect(typeof yaml).toBe('string');
    expect(yaml).toContain('apiVersion: purser/v1');
  });

  it('diffConfig returns an object with change arrays', async () => {
    const diff = await flush(mockBackend.diffConfig('apiVersion: purser/v1\n'));
    expect(Array.isArray(diff.modelsToAdd)).toBe(true);
    expect(Array.isArray(diff.deploymentsToAdd)).toBe(true);
  });

  it('applyConfig returns counts object', async () => {
    const result = await flush(mockBackend.applyConfig('apiVersion: purser/v1\n'));
    expect(typeof result.modelsAdded).toBe('number');
    expect(typeof result.deploymentsAdded).toBe('number');
  });
});

describe('compliance stubs', () => {
  it('getAiActTechnicalDoc returns a JSON string', async () => {
    const doc = await flush(mockBackend.getAiActTechnicalDoc());
    expect(typeof doc).toBe('string');
    const parsed = JSON.parse(doc);
    expect(parsed.system_name).toBeDefined();
  });

  it('getGdprRecordOfProcessing returns a JSON string', async () => {
    const doc = await flush(mockBackend.getGdprRecordOfProcessing());
    expect(typeof doc).toBe('string');
    const parsed = JSON.parse(doc);
    expect(parsed.controller).toBeDefined();
  });

  it('eraseSubject returns erasure result with subjectPrefix', async () => {
    const result = await flush(mockBackend.eraseSubject({ subjectIdentifier: 'user-12345678', subjectType: 'api_key', reason: 'test erasure' }));
    expect(result.subjectPrefix).toBe('user-123...');
    expect(typeof result.erasedEvents).toBe('number');
  });

  it('getGdprErasureLog returns an array', async () => {
    const log = await flush(mockBackend.getGdprErasureLog());
    expect(Array.isArray(log)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Data plane stubs
// ---------------------------------------------------------------------------

describe('data plane stubs', () => {
  it('listDataPlanes returns an empty array', async () => {
    const list = await flush(mockBackend.listDataPlanes());
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(0);
  });

  it('createDataPlane returns a DataPlaneWithToken', async () => {
    const result = await flush(mockBackend.createDataPlane({ name: 'demo-dp', tier: 'development' }));
    expect(result.dataplane.id).toBeDefined();
    expect(typeof result.joinToken).toBe('string');
  });

  it('refreshDataPlaneConfig resolves without throwing', async () => {
    await expect(flush(mockBackend.refreshDataPlaneConfig('dp-1'))).resolves.toBeUndefined();
  });

  it('updateDataPlane returns a DataPlane with provided fields', async () => {
    const dp = await flush(
      mockBackend.updateDataPlane('dp-1', { name: 'updated', tier: 'production', status: 'active' }),
    );
    expect(dp.id).toBe('dp-1');
    expect(dp.name).toBe('updated');
    expect(dp.tier).toBe('production');
    expect(dp.status).toBe('active');
  });

  it('updateDataPlane uses defaults when optional fields are omitted', async () => {
    const dp = await flush(mockBackend.updateDataPlane('dp-2', {}));
    expect(dp.name).toBe('demo');
    expect(dp.tier).toBe('development');
    expect(dp.status).toBe('active');
  });

  it('deleteDataPlane resolves without throwing', async () => {
    await expect(flush(mockBackend.deleteDataPlane('dp-1'))).resolves.toBeUndefined();
  });

  it('listDataPlaneNodes returns an empty array', async () => {
    const nodes = await flush(mockBackend.listDataPlaneNodes('dp-1'));
    expect(Array.isArray(nodes)).toBe(true);
  });

  it('assignNodeToDataPlane resolves without throwing', async () => {
    await expect(flush(mockBackend.assignNodeToDataPlane('dp-1', 'node-1'))).resolves.toBeUndefined();
  });

  it('unassignNodeFromDataPlane resolves without throwing', async () => {
    await expect(flush(mockBackend.unassignNodeFromDataPlane('dp-1', 'node-1'))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Service account stubs
// ---------------------------------------------------------------------------

describe('service account stubs', () => {
  it('listServiceAccounts returns an empty array', async () => {
    const list = await flush(mockBackend.listServiceAccounts());
    expect(Array.isArray(list)).toBe(true);
  });

  it('createServiceAccount returns a ServiceAccountWithSecret', async () => {
    const sa = await flush(mockBackend.createServiceAccount({ name: 'demo-sa', teamId: 'team-1', role: 'inference' }));
    expect(sa.id).toBeDefined();
    expect(typeof sa.clientSecret).toBe('string');
    expect(sa.clientSecret.length).toBeGreaterThan(0);
  });

  it('revokeServiceAccount resolves without throwing', async () => {
    await expect(flush(mockBackend.revokeServiceAccount('sa-1'))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Platform users stub
// ---------------------------------------------------------------------------

describe('platform user stubs', () => {
  it('listPlatformUsers returns an empty array', async () => {
    const list = await flush(mockBackend.listPlatformUsers());
    expect(Array.isArray(list)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pool operations
// ---------------------------------------------------------------------------

describe('pool node and quota operations', () => {
  it('listPoolNodes returns node_ids array', async () => {
    const resp = await flush(mockBackend.listPoolNodes('pool-1'));
    expect(Array.isArray(resp.node_ids)).toBe(true);
  });

  it('assignNodeToPool resolves without throwing', async () => {
    await expect(flush(mockBackend.assignNodeToPool('pool-1', 'node-1'))).resolves.toBeUndefined();
  });

  it('removeNodeFromPool resolves without throwing', async () => {
    await expect(flush(mockBackend.removeNodeFromPool('pool-1', 'node-1'))).resolves.toBeUndefined();
  });

  it('listPoolQuotas returns quotas array', async () => {
    const resp = await flush(mockBackend.listPoolQuotas('pool-1'));
    expect(Array.isArray(resp.quotas)).toBe(true);
  });

  it('getNodePool returns a pool with the given id', async () => {
    const pool = await flush(mockBackend.getNodePool('pool-test'));
    expect(pool.id).toBe('pool-test');
    expect(typeof pool.name).toBe('string');
  });

  it('updateNodePool returns updated pool', async () => {
    const pool = await flush(mockBackend.updateNodePool('pool-1', { name: 'new-name', policy: 'exclusive' }));
    expect(pool.id).toBe('pool-1');
    expect(pool.name).toBe('new-name');
    expect(pool.policy).toBe('exclusive');
  });

  it('deleteNodePool resolves without throwing', async () => {
    await expect(flush(mockBackend.deleteNodePool('pool-1'))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Team operations (additional coverage)
// ---------------------------------------------------------------------------

describe('team operations', () => {
  it('getTeam returns a team with the given id', async () => {
    const team = await flush(mockBackend.getTeam('team-test'));
    expect(team.id).toBe('team-test');
  });

  it('deleteTeam resolves without throwing', async () => {
    await expect(flush(mockBackend.deleteTeam('team-1'))).resolves.toBeUndefined();
  });

  it('listTeamMembers returns members array', async () => {
    const resp = await flush(mockBackend.listTeamMembers('team-1'));
    expect(Array.isArray(resp.members)).toBe(true);
  });

  it('removeTeamMember resolves without throwing', async () => {
    await expect(flush(mockBackend.removeTeamMember('team-1', 'user-1'))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeNode (state mutation — do LAST to not break other tests)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Branch-coverage patch — nullish coalescing fallback paths (??  right-hand sides)
// These tests deliberately omit optional fields to exercise the ?? defaults.
// ---------------------------------------------------------------------------

describe('mockBackend.upsertPoolQuota — ?? defaults', () => {
  it('applies default max_deployments=10, max_gpu_nodes=4, priority=1 when fields are omitted', async () => {
    // Passes an empty quota object {} so all three ?? fallbacks fire (lines 812-814).
    const quota = await flush(
      mockBackend.upsertPoolQuota('pool-default', 'team-default', {}),
    );
    expect(quota.max_deployments).toBe(10);
    expect(quota.max_gpu_nodes).toBe(4);
    expect(quota.priority).toBe(1);
  });
});

describe('mockBackend.createRole — ?? description default', () => {
  it('defaults description to empty string when omitted (line 850)', async () => {
    // Omits description — fires `data.description ?? ''`
    const role = await flush(
      mockBackend.createRole('desc-org', { name: 'no-desc-role', permissions: [] }),
    );
    expect(role.description).toBe('');
  });
});

describe('mockBackend.updateRole — ?? fallback to existing values', () => {
  it('keeps existing name when name is omitted from update (line 876)', async () => {
    // Create a role, then update only permissions — name should stay unchanged.
    const created = await flush(
      mockBackend.createRole('partial-org', { name: 'partial-update', permissions: [], description: 'initial' }),
    );
    // Intentionally pass only permissions (omit name/description) to exercise the ?? fallbacks.
    // Cast needed because UpdateRoleInput declares name as optional but permissions as required;
    // we want to test the runtime behavior when a partial update is sent.
    const updated = await flush(
      mockBackend.updateRole('partial-org', created.id, { permissions: ['inference:call'] } as UpdateRoleInput),
    );
    // data.name was undefined → fires `data.name ?? list[idx].name`
    expect(updated.name).toBe('partial-update');
    // description also unchanged (no description provided → fires ?? fallback)
    expect(updated.description).toBe('initial');
  });

  it('keeps existing permissions when permissions is omitted from update (line 878)', async () => {
    // Create a role with permissions, then update only name — permissions stay.
    const created = await flush(
      mockBackend.createRole('perm-org', { name: 'perm-role', permissions: ['team:metrics:view'] }),
    );
    // Cast needed: UpdateRoleInput.permissions is required in the type but the mock
    // implementation handles undefined via the `?? list[idx].permissions` fallback.
    const updated = await flush(
      mockBackend.updateRole('perm-org', created.id, { name: 'renamed-role' } as UpdateRoleInput),
    );
    // data.permissions was undefined → fires `data.permissions ?? list[idx].permissions`
    expect(updated.permissions).toEqual(['team:metrics:view']);
    expect(updated.name).toBe('renamed-role');
  });
});

describe('mockBackend.deleteRole — ?? fallback when org has no custom roles (line 891)', () => {
  it('succeeds silently when orgId has no custom roles map entry', async () => {
    // 'fresh-org' has never had createRole called, so customRolesByOrg.get('fresh-org') is undefined.
    // deleteRole fires `customRolesByOrg.get(orgId) ?? []` → right-hand `[]` branch.
    await expect(
      flush(mockBackend.deleteRole('fresh-org', 'role-does-not-exist')),
    ).resolves.toBeUndefined();
  });
});

describe('mockBackend.advanceDeployment — intermediate progress stages (lines 211-218, 227)', () => {
  it('covers Downloading (0<p<0.4), Loading (0.4<=p<0.85), Warming (0.85<=p<1), Serving (p>=1)', async () => {
    // perNodeMs=5200, staggerMs=1300. With forceNodeCount:1, node i=0 → start=0.
    // progress = elapsed/5200 where elapsed = Date.now() - dep.createdAt.
    //
    // TIMING NOTE: each flush() call fires vi.runAllTimersAsync() which advances
    // the fake clock by the delay() duration (createDeployment=500ms, getDeployment=180ms).
    // dep.createdAt is stamped at the moment createDeployment() is called (before delay fires).
    // Cumulative clock after setup: T0 + 500ms (create) → T0 + 1800ms (advance 1300) →
    // advanceDeployment runs at T0+1800ms (elapsed=1800ms, p=0.346 Downloading ✓)
    // then clock → T0+1980ms after flush.

    const dep = await flush(
      mockBackend.createDeployment('phi4-14b', { forceNodeCount: 1, preference: 'balanced' }),
    );
    // dep.createdAt = T0; clock is now T0 + 500ms

    // Stage: 0 < progress < 0.4 → detail='Downloading…' (line 211 TRUE branch)
    // elapsed when advanceDeployment runs = T0 + 500 + 1300 = T0+1800ms → p = 1800/5200 = 0.346
    vi.advanceTimersByTime(1_300);
    const d1 = await flush(mockBackend.getDeployment(dep.id)); // clock → T0+1980ms
    expect(d1.nodeStatus[0].progress).toBeGreaterThan(0);
    expect(d1.nodeStatus[0].progress).toBeLessThan(0.4);
    expect(d1.nodeStatus[0].detail).toMatch(/Downloading/);
    expect(d1.nodeStatus[0].state).toBe('loading');  // line 218 FALSE branch (p<1)
    expect(d1.state).toBe('provisioning');            // line 227 FALSE branch (not all ready)

    // Stage: 0.4 <= progress < 0.85 → detail='Loading…' (line 212 TRUE branch)
    // clock: T0+1980 + 1300 = T0+3280ms → p = 3280/5200 = 0.631
    vi.advanceTimersByTime(1_300);
    const d2 = await flush(mockBackend.getDeployment(dep.id)); // clock → T0+3460ms
    expect(d2.nodeStatus[0].progress).toBeGreaterThanOrEqual(0.4);
    expect(d2.nodeStatus[0].progress).toBeLessThan(0.85);
    expect(d2.nodeStatus[0].detail).toMatch(/Loading/);

    // Stage: 0.85 <= progress < 1.0 → detail='Warming…' (line 213 TRUE branch)
    // Advance 1000ms: clock T0+3460+1000=T0+4460ms → p = 4460/5200 = 0.858 ✓ (0.85 <= 0.858 < 1)
    vi.advanceTimersByTime(1_000);
    const d3 = await flush(mockBackend.getDeployment(dep.id)); // clock → T0+4640ms
    expect(d3.nodeStatus[0].progress).toBeGreaterThanOrEqual(0.85);
    expect(d3.nodeStatus[0].progress).toBeLessThan(1);
    expect(d3.nodeStatus[0].detail).toMatch(/Warming/);

    // Stage: progress >= 1 → detail='Serving', state='running' (lines 214, 218 TRUE branches)
    // Advance 700ms: clock T0+4640+700=T0+5340ms → p = 5340/5200 = 1.027 → clamped to 1.0
    vi.advanceTimersByTime(700);
    const d4 = await flush(mockBackend.getDeployment(dep.id));
    expect(d4.nodeStatus[0].progress).toBe(1);
    expect(d4.nodeStatus[0].detail).toBe('Serving');  // line 214 TRUE
    expect(d4.nodeStatus[0].state).toBe('running');   // line 218 TRUE
    expect(d4.state).toBe('active');                  // line 227 TRUE (allReady)
  });
});

describe('mockBackend.getPlan — loop FALSE branch (line 392)', () => {
  it('throws NotFoundError when planId matches no deployment in the for-of loop', async () => {
    // Explicitly ensure there is at least one deployment so the loop iterates.
    // createDeployment stores its plan in the plans Map, so getPlan(dep.plan.planId) would
    // hit the early-return. We test with a *different* ghost planId to force the loop false-branch.
    const dep = await flush(
      mockBackend.createDeployment('qwen3-moe-235b', { forceNodeCount: null, preference: 'balanced' }),
    );
    // dep.plan.planId is in the plans Map — DON'T use it; use 'ghost-plan' instead
    expect(dep.plan.planId).toBeDefined();
    // plans.get('ghost-plan-xx') = undefined, loop fires, dep.plan.planId ≠ 'ghost-plan-xx' → FALSE branch
    expect(() => mockBackend.getPlan('ghost-plan-xx')).toThrow(NotFoundError);
  });
});

describe('mockBackend.createNodePool — ?? defaults (line 750)', () => {
  it('applies default name, owner_type, owner_id, policy when all fields are omitted', async () => {
    // Passes an empty data object {} so all ?? fallbacks fire (line 750 and relatives).
    const pool = await flush(mockBackend.createNodePool({}));
    expect(pool.name).toBe('Mock Pool');
    expect(pool.owner_type).toBe('platform');
    expect(pool.owner_id).toBe('platform');
    expect(pool.policy).toBe('shared');
    expect(Array.isArray(pool.node_ids)).toBe(true);
  });
});

describe('mockBackend.updateNodePool — ?? defaults (lines 777, 781)', () => {
  it('applies default name and policy when both fields are omitted', async () => {
    const pool = await flush(mockBackend.updateNodePool('pool-x', {}));
    expect(pool.name).toBe('Mock Pool');    // line 777: input.name ?? 'Mock Pool'
    expect(pool.policy).toBe('shared');    // line 781: input.policy ?? 'shared'
  });
});

describe('mockBackend.createRole — permissions ?? [] (line 850)', () => {
  it('defaults permissions to empty array when field is omitted', async () => {
    // Omits both description AND permissions — fires both ?? fallbacks.
    // Cast needed: CreateRoleInput declares permissions as required, but the mock
    // implementation handles undefined via `data.permissions ?? []`.
    const role = await flush(
      mockBackend.createRole('perms-fallback-org', { name: 'no-perms-role' } as CreateRoleInput),
    );
    expect(role.permissions).toEqual([]); // line 850: data.permissions ?? []
    expect(role.description).toBe('');    // description ?? '' also covered
  });
});

describe('mockBackend.removeNode', () => {
  it('removes the node so it no longer appears in listNodes', async () => {
    const before = await flush(mockBackend.listNodes());
    // Use the edge/unreachable node which has no active deployment
    const target = before.find((n) => n.profile.state === 'unreachable');
    expect(target).toBeDefined();
    await flush(mockBackend.removeNode(target!.profile.nodeId));
    const after = await flush(mockBackend.listNodes());
    const found = after.find((n) => n.profile.nodeId === target!.profile.nodeId);
    expect(found).toBeUndefined();
    expect(after.length).toBe(before.length - 1);
  });

  it('throws NotFoundError synchronously for unknown nodeId', () => {
    expect(() => mockBackend.removeNode('ghost-node')).toThrow(NotFoundError);
  });
});
