// ---------------------------------------------------------------------------
// Mutation-killer tests for http.ts.
//
// Each test was written SPECIFICALLY to kill a Stryker mutant that survived
// the broader suites.  Three strategies:
//  (a) URL/method verification — spy on fetch, assert exact path and HTTP verb.
//  (b) Full-field assertions — check EVERY output field of a normalizer.
//  (c) Boundary/conditional mutations — test both sides of a conditional.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHttpApi } from '../http';

const api = createHttpApi('/api/v1');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as unknown as Response);
}

function capture204() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true, status: 204,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response);
}

function captureFetch(responseBody: unknown, status = 200) {
  const text = JSON.stringify(responseBody);
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as unknown as Response);
}

const nodeWireShape = {
  node_id: 'n-1', hostname: 'box', os: 'linux', arch: 'x86_64',
  backends: ['cpu'], gpus: [],
  ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
  engine_versions: {}, last_seen: '2026-09-10T00:00:00Z', state: 'ready',
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// URL + HTTP method assertions (kills StringLiteral / ObjectLiteral mutations)
// ---------------------------------------------------------------------------

describe('endpoint URLs and HTTP methods', () => {
  it('getCapacity GETs /cluster/health', async () => {
    const spy = captureFetch({ node_count: 1 });
    await api.getCapacity();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/cluster/health');
    expect(spy.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('listNodes GETs /nodes', async () => {
    const spy = captureFetch({ nodes: [nodeWireShape] });
    await api.listNodes();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/nodes');
    expect(spy.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('getNode GETs /nodes/:id', async () => {
    const spy = captureFetch(nodeWireShape);
    await api.getNode('n-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/nodes/n-1');
  });

  it('drainNode POSTs to /nodes/:id/drain', async () => {
    const spy = captureFetch(nodeWireShape);
    await api.drainNode('n-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/nodes/n-1/drain');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('restartNode POSTs to /nodes/:id/restart', async () => {
    const spy = captureFetch(nodeWireShape);
    await api.restartNode('n-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/nodes/n-1/restart');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('removeNode DELETEs /nodes/:id', async () => {
    const spy = capture204();
    await api.removeNode('n-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/nodes/n-1');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('getCatalog GETs /models', async () => {
    const spy = captureFetch({ models: [] });
    await api.getCatalog();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/models');
    expect(spy.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('deleteModel DELETEs /models/:id', async () => {
    const spy = capture204();
    await api.deleteModel('llama3');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/models/llama3');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('planDeployment POSTs to /models/:id/plan', async () => {
    const spy = captureFetch({ plan_id: 'p-1', model_id: 'llama3', assignments: [] });
    await api.planDeployment('llama3', { forceNodeCount: null, preference: 'balanced' });
    expect(spy.mock.calls[0][0]).toBe('/api/v1/models/llama3/plan');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('createDeployment POSTs to /models/:id/deploy', async () => {
    const spy = captureFetch({ id: 'd-1', state: 'active', detail: { model_id: 'llama3', engines: [] } });
    await api.createDeployment('llama3', { forceNodeCount: null, preference: 'balanced' });
    expect(spy.mock.calls[0][0]).toBe('/api/v1/models/llama3/deploy');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('listDeployments GETs /deployments', async () => {
    const spy = captureFetch({ deployments: [] });
    await api.listDeployments();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/deployments');
    expect(spy.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('getDeployment GETs /deployments/:id', async () => {
    const spy = captureFetch({ id: 'd-1', state: 'active', detail: { model_id: 'llama3', engines: [] } });
    await api.getDeployment('d-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/deployments/d-1');
  });

  it('undeployDeployment DELETEs /deployments/:id', async () => {
    const spy = capture204();
    await api.undeployDeployment('d-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/deployments/d-1');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('getPlan GETs /plans/:id', async () => {
    const spy = captureFetch({ plan_id: 'p-1', model_id: 'llama3', assignments: [] });
    await api.getPlan('p-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/plans/p-1');
  });

  it('getJoinInfo POSTs to /join-token with ttl body', async () => {
    const spy = captureFetch({ token: 'tok', cluster_id: 'default', expires_at: '2026-09-14T00:00:00Z' });
    await api.getJoinInfo();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/join-token');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
    // snakeizeKeys converts ttlSeconds → ttl_seconds
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.ttl_seconds).toBe(86400);
  });

  it('rotateJoinToken POSTs to /join-token', async () => {
    const spy = captureFetch({ token: 'tok-new', cluster_id: 'default', expires_at: '2026-09-14T00:00:00Z' });
    await api.rotateJoinToken();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/join-token');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('listApiKeys GETs /apikeys', async () => {
    const spy = captureFetch({ apikeys: [] });
    await api.listApiKeys();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/apikeys');
  });

  it('revokeApiKey DELETEs /apikeys/:id', async () => {
    const spy = captureFetch({ id: 'k-1', name: 'test', revoked: true });
    await api.revokeApiKey('k-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/apikeys/k-1');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('getAuditLog GETs /enterprise/audit-log with limit param', async () => {
    const spy = captureFetch({ feature: 'audit', licensee: 'purser', entries: [], chain: { verified: true, length: 0 } });
    await api.getAuditLog();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/enterprise/audit-log?limit=100');
  });

  it('getSloComplianceFull GETs /slo/compliance with window_hours param', async () => {
    const spy = captureFetch({ models: [], window_hours: 48, generated_at: '2026-09-13T00:00:00Z' });
    await api.getSloComplianceFull(48);
    expect(spy.mock.calls[0][0]).toContain('window_hours=48');
  });

  it('getSloComplianceFull uses windowHours=24 as default', async () => {
    const spy = captureFetch({ models: [], window_hours: 24, generated_at: '2026-09-13T00:00:00Z' });
    await api.getSloComplianceFull();
    expect(spy.mock.calls[0][0]).toContain('window_hours=24');
  });

  it('listPolicies GETs /policies', async () => {
    const spy = captureFetch({ policies: [] });
    await api.listPolicies();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/policies');
  });

  it('upsertPolicy PUTs to /policies/:name', async () => {
    const spy = captureFetch({ id: 1, name: 'test', rego: '', enabled: true });
    await api.upsertPolicy('test', '# rego', true);
    expect(spy.mock.calls[0][0]).toBe('/api/v1/policies/test');
    expect(spy.mock.calls[0][1]?.method).toBe('PUT');
  });

  it('deletePolicy DELETEs /policies/:name', async () => {
    const spy = capture204();
    await api.deletePolicy('test');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/policies/test');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('listServiceAccounts GETs /service-accounts', async () => {
    const spy = captureFetch([]);
    await api.listServiceAccounts();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/service-accounts');
  });

  it('revokeServiceAccount DELETEs /service-accounts/:id', async () => {
    const spy = capture204();
    await api.revokeServiceAccount('sa-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/service-accounts/sa-1');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('getClusterStatus GETs /cluster/status', async () => {
    const spy = captureFetch({ mode: 'single', is_leader: true });
    await api.getClusterStatus();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/cluster/status');
  });

  it('listDataPlanes GETs /platform/dataplanes', async () => {
    const spy = captureFetch([]);
    await api.listDataPlanes();
    expect(spy.mock.calls[0][0]).toBe('/api/v1/platform/dataplanes');
  });

  it('refreshDataPlaneConfig POSTs to /platform/dataplanes/:id/config/refresh', async () => {
    const spy = capture204();
    await api.refreshDataPlaneConfig('dp-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/platform/dataplanes/dp-1/config/refresh');
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('listRoles GETs /platform/orgs/:orgId/roles', async () => {
    const spy = captureFetch({ roles: [] });
    await api.listRoles('org-1');
    expect(spy.mock.calls[0][0]).toBe('/api/v1/platform/orgs/org-1/roles');
  });
});

// ---------------------------------------------------------------------------
// normalizeDeployment — exhaustive field assertions (L444 — 12 mutations)
// ---------------------------------------------------------------------------

describe('normalizeDeployment — exhaustive field assertions', () => {
  const engineShape = {
    node_id: 'n-1',
    role: 'host',
    layer_start: 0,
    layer_end: 32,
    draft: false,
  };
  const detailShape = {
    model_id: 'llama3-8b',
    quantization: 'q4_k_m',
    engines: [engineShape],
  };

  it('normalizes all plan fields from a full deployment response', async () => {
    mockFetch({
      id: 'dep-full',
      state: 'DEPLOYMENT_STATE_ACTIVE',
      created_at: '2026-09-10T12:00:00Z',
      detail: detailShape,
    });
    const dep = await api.getDeployment('dep-full');
    expect(dep.id).toBe('dep-full');
    expect(dep.state).toBe('active');
    expect(dep.createdAt).toBe('2026-09-10T12:00:00Z');
    expect(dep.plan.modelId).toBe('llama3-8b');
    expect(dep.plan.quantization).toBe('q4_k_m');
    expect(dep.plan.assignments).toHaveLength(1);
    expect(dep.plan.assignments[0].nodeId).toBe('n-1');
    expect(dep.plan.assignments[0].role).toBe('host');
    expect(dep.plan.assignments[0].layerStart).toBe(0);
    expect(dep.plan.assignments[0].layerEnd).toBe(32);
    expect(dep.plan.assignments[0].draft).toBe(false);
    expect(dep.plan.pipelineOrder).toEqual(['n-1']);
    expect(dep.nodeStatus).toHaveLength(1);
    expect(dep.nodeStatus[0].nodeId).toBe('n-1');
    expect(dep.nodeStatus[0].state).toBe('running'); // active → running
    expect(dep.nodeStatus[0].progress).toBe(1);
    expect(dep.nodeStatus[0].detail).toBe('');
  });

  it('nodeStatus.state is loading when deployment state is provisioning', async () => {
    mockFetch({
      id: 'dep-prov',
      state: 'DEPLOYMENT_STATE_PROVISIONING',
      detail: { model_id: 'llama3', quantization: 'q4', engines: [engineShape] },
    });
    const dep = await api.getDeployment('dep-prov');
    expect(dep.state).toBe('provisioning');
    expect(dep.nodeStatus[0].state).toBe('loading'); // non-active → loading
    expect(dep.nodeStatus[0].progress).toBe(0);
  });

  it('nodeStatus is taken from nodeStatus array when detail branch is not active', async () => {
    // The detail-branch (d.detail present) always derives nodeStatus from engines.
    // The plan-branch uses d.nodeStatus if present as an array.
    // Verify the plan-branch by sending { plan, nodeStatus } without a detail key.
    mockFetch({
      id: 'dep-ns',
      state: 'DEPLOYMENT_STATE_ACTIVE',
      plan: {
        planId: 'p-ns',
        modelId: 'llama3',
        quantization: 'q4',
        assignments: [{ nodeId: 'n-1', role: 'host', layerStart: 0, layerEnd: 32, draft: false }],
      },
      nodeStatus: [{ nodeId: 'n-2', state: 'running', progress: 0.7, detail: 'layer 16' }],
    });
    const dep = await api.getDeployment('dep-ns');
    expect(dep.nodeStatus[0].nodeId).toBe('n-2');
    expect(dep.nodeStatus[0].progress).toBe(0.7);
    expect(dep.nodeStatus[0].detail).toBe('layer 16');
  });
});

// ---------------------------------------------------------------------------
// normalizePlan — all fields (L356-L370)
// ---------------------------------------------------------------------------

describe('normalizePlan — all fields checked', () => {
  it('normalizes all fields from a plan response', async () => {
    mockFetch({
      plan_id: 'p-all',
      model_id: 'llama3-70b',
      quantization: 'q4_k_m',
      pipeline_order: ['n-1', 'n-2'],
      assignments: [
        { node_id: 'n-1', role: 'host', layer_start: 0, layer_end: 20, draft: false },
        { node_id: 'n-2', role: 'worker', layer_start: 20, layer_end: 40, draft: false },
      ],
      estimated: {
        decode_tok_s_min: 15, decode_tok_s_max: 35,
        prefill_tok_s_min: 80, prefill_tok_s_max: 160,
        headroom_gb: 2.5,
      },
      cost: 42,
      explanation: ['Node n-1 has CUDA', 'Node n-2 has enough RAM'],
    });
    const plan = await api.getPlan('p-all');
    expect(plan.planId).toBe('p-all');
    expect(plan.modelId).toBe('llama3-70b');
    expect(plan.quantization).toBe('q4_k_m');
    expect(plan.pipelineOrder).toEqual(['n-1', 'n-2']);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.assignments[1].role).toBe('worker');
    expect(plan.assignments[1].layerStart).toBe(20);
    expect(plan.estimated.decodeTokSMin).toBe(15);
    expect(plan.estimated.decodeTokSMax).toBe(35);
    expect(plan.estimated.prefillTokSMin).toBe(80);
    expect(plan.estimated.prefillTokSMax).toBe(160);
    expect(plan.estimated.headroomGb).toBe(2.5);
    expect(plan.cost).toBe(42);
    expect(plan.explanation).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Request error-body extraction boundary conditions (L193, L235, L239)
// ---------------------------------------------------------------------------

describe('request error body extraction — boundary conditions', () => {
  it('uses body.message when non-empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 404,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ message: 'not found', code: 'ERR_NOT_FOUND' })),
      json: () => Promise.resolve({ message: 'not found', code: 'ERR_NOT_FOUND' }),
    } as unknown as Response);
    let caught: Error | undefined;
    try { await api.getNode('x'); } catch (e) { caught = e as Error; }
    expect(caught!.message).toBe('not found');
  });

  it('uses body.error when message is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 422,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ error: 'constraint violated' })),
      json: () => Promise.resolve({ error: 'constraint violated' }),
    } as unknown as Response);
    let caught: Error | undefined;
    try { await api.createDeployment('llama3', { forceNodeCount: null, preference: 'balanced' }); }
    catch (e) { caught = e as Error; }
    expect(caught!.message).toBe('constraint violated');
  });

  it('falls back to HTTP status when both message and error are absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 503,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ code: 'unavailable' })),
      json: () => Promise.resolve({ code: 'unavailable' }),
    } as unknown as Response);
    let caught: Error | undefined;
    try { await api.getCatalog(); } catch (e) { caught = e as Error; }
    expect(caught!.message).toContain('503');
  });

  it('falls back when message is empty string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 500,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ message: '' })),
      json: () => Promise.resolve({ message: '' }),
    } as unknown as Response);
    let caught: Error | undefined;
    try { await api.getCatalog(); } catch (e) { caught = e as Error; }
    expect(caught!.message).toContain('500');
  });

  it('does not use message when body is a primitive (non-object)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 400,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve('"just a string"'),
      json: () => Promise.resolve('just a string'),
    } as unknown as Response);
    let caught: Error | undefined;
    try { await api.getCatalog(); } catch (e) { caught = e as Error; }
    expect(caught!.message).toContain('400');
  });
});

// ---------------------------------------------------------------------------
// normalizeFit — all fields (L612, L617 — 7 mutations)
// ---------------------------------------------------------------------------

describe('normalizeFit — all fields checked', () => {
  it('returns full fit object with all numeric fields', async () => {
    mockFetch({
      models: [{
        id: 'llama3',
        spec: {
          model_id: 'llama3-8b', family: 'llama3',
          quantizations: [{ name: 'q4_k_m', size_gb: 4.5, vram_gb: 5.0 }],
        },
        fit: {
          quantization: 'q4_k_m',
          nodes_needed: 2,
          deficit_gb: 0,
          reason_key: 'fits',
          estimated: { decode_tok_s_min: 20, decode_tok_s_max: 40,
            prefill_tok_s_min: 100, prefill_tok_s_max: 200, headroom_gb: 1.5 },
        },
        deployable: true,
      }],
    });
    const catalog = await api.getCatalog();
    const fit = catalog[0].fit!;
    expect(fit).not.toBeNull();
    expect(fit.quantization).toBe('q4_k_m');
    expect(fit.nodesNeeded).toBe(2);
    expect(fit.deficitGb).toBe(0);
    expect(fit.reasonKey).toBe('fits');
    expect(fit.estimated).not.toBeNull();
    expect(fit.estimated!.decodeTokSMin).toBe(20);
    expect(fit.estimated!.decodeTokSMax).toBe(40);
    expect(fit.estimated!.prefillTokSMin).toBe(100);
    expect(fit.estimated!.prefillTokSMax).toBe(200);
    expect(fit.estimated!.headroomGb).toBe(1.5);
  });

  it('returns not_enough_memory with non-zero deficitGb', async () => {
    mockFetch({
      models: [{
        id: 'llama3-70b',
        spec: { model_id: 'llama3-70b', family: 'llama3', quantizations: [{ name: 'q4_k_m', size_gb: 40, vram_gb: 42 }] },
        fit: { quantization: null, nodes_needed: 0, deficit_gb: 12, reason_key: 'not_enough_memory', estimated: null },
        deployable: false,
      }],
    });
    const catalog = await api.getCatalog();
    const fit = catalog[0].fit;
    expect(fit.reasonKey).toBe('not_enough_memory');
    expect(fit.deficitGb).toBe(12);
    expect(fit.estimated).toBeNull();
    // CatalogEntry has no deployable field — infer from fit.fits
    expect(fit.fits).toBe(false);
  });

  it('synthesizes a fit stub when fit is null but deployable is true', async () => {
    // Shape A has model at top level — normalizeCatalogEntry reads e.deployable from the entry.
    mockFetch({
      models: [{
        model: { modelId: 'small', family: 'gpt', quantizations: [{ name: 'fp16', sizeGb: 2, vramGb: 2 }] },
        fit: null,
        deployable: true,
      }],
    });
    const catalog = await api.getCatalog();
    const fit = catalog[0].fit;
    // fit.fits (derived from deployable=true) signals the model is deployable
    expect(fit.fits).toBe(true);
    expect(fit.nodesNeeded).toBe(1);
    expect(fit.reasonKey).toBe('fits');
    expect(fit.deficitGb).toBe(0);
    expect(fit.estimated).toBeNull();
    // quantization comes from model.quantizations[0].name
    expect(fit.quantization).toBe('fp16');
  });

  it('synthesizes an infeasible stub when fit is null and deployable is false', async () => {
    mockFetch({
      models: [{
        id: 'giant',
        spec: { model_id: 'giant', family: 'llama3', quantizations: [{ name: 'fp16', size_gb: 200, vram_gb: 210 }] },
        fit: null,
        deployable: false,
      }],
    });
    const catalog = await api.getCatalog();
    const fit = catalog[0].fit;
    // fit.fits (derived from deployable=false) signals the model is NOT deployable
    expect(fit.fits).toBe(false);
    expect(fit.reasonKey).toBe('not_enough_memory');
    expect(fit.nodesNeeded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeDeploymentApproval — all fields (L737-L742)
// ---------------------------------------------------------------------------

describe('normalizeDeploymentApproval — all fields', () => {
  // listDeploymentApprovals returns DeploymentApproval[] directly
  it('returns all fields normalized from a fully populated approval', async () => {
    mockFetch({
      approvals: [{
        id: 42,
        deployment_id: 'dep-approve-all',
        model_id: 'llama3-70b',
        requester: 'alice',
        requested_at: '2026-09-10T08:00:00Z',
        status: 'approved',
        reviewer: 'bob',
        reviewed_at: '2026-09-10T09:00:00Z',
      }],
    });
    const approvals = await api.listDeploymentApprovals();
    const a = approvals[0];
    expect(a.id).toBe(42);
    expect(a.deploymentId).toBe('dep-approve-all');
    expect(a.modelId).toBe('llama3-70b');
    expect(a.requester).toBe('alice');
    expect(a.requestedAt).toBe('2026-09-10T08:00:00Z');
    expect(a.status).toBe('approved');
    expect(a.reviewer).toBe('bob');
    expect(a.reviewedAt).toBe('2026-09-10T09:00:00Z');
  });

  it('reviewer and reviewedAt are undefined for pending approvals', async () => {
    mockFetch({
      approvals: [{
        id: 99,
        deployment_id: 'dep-pend',
        model_id: 'llama3',
        requester: 'carol',
        requested_at: '2026-09-11T00:00:00Z',
        status: 'pending',
      }],
    });
    const approvals = await api.listDeploymentApprovals();
    const a = approvals[0];
    expect(a.status).toBe('pending');
    expect(a.reviewer).toBeUndefined();
    expect(a.reviewedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeJoinInfo / normalizeJoinTokenResult — all fields
// ---------------------------------------------------------------------------

describe('normalizeJoinInfo — all fields', () => {
  it('populates joinToken, controlPlaneUrl, expiresAt', async () => {
    mockFetch({
      join_token: 'prsr-tok-xyz',
      control_plane_url: 'https://cp.example.com:9443',
      expires_at: '2026-09-14T00:00:00Z',
    });
    const info = await api.getJoinInfo();
    expect(info.joinToken).toBe('prsr-tok-xyz');
    expect(info.controlPlaneUrl).toBe('https://cp.example.com:9443');
    expect(info.expiresAt).toBe('2026-09-14T00:00:00Z');
  });
});

describe('normalizeJoinTokenResult — all fields (from createJoinToken)', () => {
  it('token, clusterId, expiresAt are populated', async () => {
    mockFetch({
      token: 'prsr-entry-1',
      cluster_id: 'cluster-a',
      expires_at: '2026-10-01T00:00:00Z',
    });
    const result = await api.createJoinToken(86400);
    expect(result.token).toBe('prsr-entry-1');
    expect(result.clusterId).toBe('cluster-a');
    expect(result.expiresAt).toBe('2026-10-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// normalizeNodeView — all profile fields
// ---------------------------------------------------------------------------

describe('normalizeNodeView — all profile fields', () => {
  it('normalizes all numeric profile fields', async () => {
    mockFetch({
      nodes: [{
        node_id: 'n-full',
        hostname: 'gpu-server-01',
        os: 'linux',
        arch: 'x86_64',
        backends: ['cuda', 'cpu'],
        gpus: [{ name: 'A100', vram_gb: 40 }],
        ram_total_gb: 256,
        ram_available_gb: 200,
        mem_bandwidth_gbs: 900,
        disk_free_gb: 1000,
        engine_versions: { 'llama.cpp': '1.0.0' },
        last_seen: '2026-09-12T08:00:00Z',
        state: 'NODE_STATE_READY',
        link_quality: 'excellent',
      }],
    });
    const nodes = await api.listNodes();
    const p = nodes[0].profile;
    expect(p.nodeId).toBe('n-full');
    expect(p.hostname).toBe('gpu-server-01');
    expect(p.os).toBe('linux');
    expect(p.arch).toBe('x86_64');
    expect(p.backends).toEqual(['cuda', 'cpu']);
    expect(p.ramTotalGb).toBe(256);
    expect(p.ramAvailableGb).toBe(200);
    expect(p.memBandwidthGbs).toBe(900);
    expect(p.diskFreeGb).toBe(1000);
    expect(p.state).toBe('ready');
    expect(nodes[0].linkQuality).toBe('excellent');
  });

  it('normalizes flat shape — metrics null, role null, linkQuality unknown, deploymentId null', async () => {
    mockFetch({ nodes: [nodeWireShape] });
    const nodes = await api.listNodes();
    expect(nodes[0].profile.nodeId).toBeTruthy();
    expect(nodes[0].metrics).toBeNull();
    expect(nodes[0].role).toBeNull();
    expect(nodes[0].linkQuality).toBe('unknown');
    expect(nodes[0].deploymentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeAuditLog — chain fields
// ---------------------------------------------------------------------------

describe('normalizeAuditLog — chain fields', () => {
  it('chain.break is undefined when not broken', async () => {
    mockFetch({
      feature: 'audit',
      licensee: 'purser',
      entries: [],
      chain: { verified: true, length: 5 },
    });
    const log = await api.getAuditLog();
    expect(log.chain.verified).toBe(true);
    expect(log.chain.length).toBe(5);
    expect(log.chain.break).toBeUndefined();
    expect(log.licensee).toBe('purser');
    expect(log.feature).toBe('audit');
  });

  it('chain.break is populated when break is present', async () => {
    mockFetch({
      feature: 'audit',
      licensee: 'purser',
      entries: [],
      chain: { verified: false, length: 10, break: { at_seq: 5, expected_hash: 'abc', found_hash: 'def', index: 5, kind: 'hash_mismatch', msg: 'mismatch' } },
    });
    const log = await api.getAuditLog();
    expect(log.chain.verified).toBe(false);
    expect(log.chain.break).toBeDefined();
    // The break object is the raw camelized shape
    expect((log.chain.break as unknown as Record<string, unknown>).index).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// normalizeCapacity — all fields
// ---------------------------------------------------------------------------

describe('normalizeCapacity — all fields', () => {
  it('normalizes all capacity fields', async () => {
    mockFetch({
      node_count: 5,
      ready_node_count: 4,
      ram_total_gb: 512,
      ram_available_gb: 400,
      vram_total_gb: 200,
      vram_available_gb: 150,
      gpu_count: 8,
      backends: ['cuda'],
      fp4_capable: true,
      aggregate_decode_tok_s: 1200,
    });
    const cap = await api.getCapacity();
    expect(cap.nodeCount).toBe(5);
    expect(cap.readyNodeCount).toBe(4);
    expect(cap.ramTotalGb).toBe(512);
    expect(cap.ramAvailableGb).toBe(400);
    expect(cap.vramTotalGb).toBe(200);
    expect(cap.vramAvailableGb).toBe(150);
    expect(cap.gpuCount).toBe(8);
    expect(cap.backends).toEqual(['cuda']);
    expect(cap.fp4Capable).toBe(true);
    expect(cap.aggregateDecodeTokS).toBe(1200);
  });

  it('accepts totalNodes/readyNodes as aliases', async () => {
    mockFetch({ total_nodes: 3, ready_nodes: 2, backends: [] });
    const cap = await api.getCapacity();
    expect(cap.nodeCount).toBe(3);
    expect(cap.readyNodeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getSloComplianceFull — all fields (kills L970 mutations)
// ---------------------------------------------------------------------------

describe('getSloComplianceFull — complete output', () => {
  it('normalizes all SLO model fields', async () => {
    mockFetch({
      window_hours: 72,
      generated_at: '2026-09-13T10:00:00Z',
      models: [{
        model_id: 'llama3-70b',
        slo: { ttft_ms: 1500, tbt_ms: 300, target_compliance: 0.99 },
        actual: {
          ttft_compliance: 0.97,
          tbt_compliance: 0.98,
          request_count: 5000,
          period_start: '2026-09-10T00:00:00Z',
        },
        status: 'met',
      }],
    });
    const resp = await api.getSloComplianceFull(72);
    expect(resp.window_hours).toBe(72);
    expect(resp.generated_at).toBe('2026-09-13T10:00:00Z');
    const m = resp.models[0];
    expect(m.model_id).toBe('llama3-70b');
    expect(m.slo.ttft_ms).toBe(1500);
    expect(m.slo.tbt_ms).toBe(300);
    expect(m.slo.target_compliance).toBe(0.99);
    expect(m.actual.ttft_compliance).toBe(0.97);
    expect(m.actual.tbt_compliance).toBe(0.98);
    expect(m.actual.request_count).toBe(5000);
    expect(m.actual.period_start).toBe('2026-09-10T00:00:00Z');
    expect(m.status).toBe('met');
  });

  it('preserves null ttft_compliance (nullable pointer)', async () => {
    mockFetch({
      window_hours: 24,
      generated_at: '2026-09-13T00:00:00Z',
      models: [{ model_id: 'new-m', slo: { ttft_ms: 2000, tbt_ms: 500, target_compliance: 0.95 },
        actual: { ttft_compliance: null, tbt_compliance: null, request_count: 0, period_start: '' },
        status: 'insufficient_data' }],
    });
    const resp = await api.getSloComplianceFull();
    expect(resp.models[0].actual.ttft_compliance).toBeNull();
    expect(resp.models[0].actual.tbt_compliance).toBeNull();
    expect(resp.models[0].status).toBe('insufficient_data');
  });

  it('uses windowHours parameter as fallback for window_hours when absent', async () => {
    mockFetch({ models: [{ model_id: 'bare' }] });
    const resp = await api.getSloComplianceFull(48);
    expect(resp.window_hours).toBe(48);
    const m = resp.models[0];
    expect(m.slo.ttft_ms).toBe(2000);
    expect(m.slo.tbt_ms).toBe(500);
    expect(m.slo.target_compliance).toBe(0.95);
    expect(m.status).toBe('insufficient_data');
  });
});

// ---------------------------------------------------------------------------
// normalizeSnapshot (MetricsSnapshot) — all fields
// ---------------------------------------------------------------------------

describe('normalizeSnapshot — all fields', () => {
  it('snapshot with nodes has all fields populated', async () => {
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          (this.onmessage as (e: { data: string }) => void)({
            data: JSON.stringify({
              at: '2026-09-13T10:00:00Z',
              aggregate_decode_tok_s: 350,
              nodes: [{
                node_id: 'n-1',
                metrics: {
                  prefill_tok_s: 100, decode_tok_s: 50,
                  ram_used_gb: 10, vram_used_gb: 20,
                  queue_depth: 2, accepted_tokens_ratio: 0.95,
                },
              }],
            }),
          });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);

    const snapshotPromise = new Promise<Parameters<Parameters<typeof api.streamMetrics>[0]['onMetrics']>[0]>((resolve) => {
      api.streamMetrics({ onMetrics: resolve });
    });
    const snapshot = await snapshotPromise;
    expect(snapshot.at).toBe('2026-09-13T10:00:00Z');
    expect(snapshot.aggregateDecodeTokS).toBe(350);
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0].nodeId).toBe('n-1');
    expect(snapshot.nodes[0].metrics.decodeTokS).toBe(50);
    expect(snapshot.nodes[0].metrics.prefillTokS).toBe(100);
    expect(snapshot.nodes[0].metrics.ramUsedGb).toBe(10);
    expect(snapshot.nodes[0].metrics.vramUsedGb).toBe(20);
    expect(snapshot.nodes[0].metrics.queueDepth).toBe(2);
    expect(snapshot.nodes[0].metrics.acceptedTokensRatio).toBe(0.95);

    vi.unstubAllGlobals();
  });

  it('aggregateDecodeTokS is summed from nodes when absent', async () => {
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          (this.onmessage as (e: { data: string }) => void)({
            data: JSON.stringify({
              at: '2026-09-13T10:00:00Z',
              // no aggregate_decode_tok_s
              nodes: [
                { node_id: 'n-1', metrics: { decode_tok_s: 30, prefill_tok_s: 0, ram_used_gb: 0, vram_used_gb: 0, queue_depth: 0, accepted_tokens_ratio: 0 } },
                { node_id: 'n-2', metrics: { decode_tok_s: 20, prefill_tok_s: 0, ram_used_gb: 0, vram_used_gb: 0, queue_depth: 0, accepted_tokens_ratio: 0 } },
              ],
            }),
          });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);

    const snapshotPromise = new Promise<Parameters<Parameters<typeof api.streamMetrics>[0]['onMetrics']>[0]>((resolve) => {
      api.streamMetrics({ onMetrics: resolve });
    });
    const snapshot = await snapshotPromise;
    // Should be 30 + 20 = 50
    expect(snapshot.aggregateDecodeTokS).toBe(50);

    vi.unstubAllGlobals();
  });
});
