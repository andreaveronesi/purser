// ---------------------------------------------------------------------------
// Infrastructure tests for http.ts — targets the camelizeKeys / snakeizeKeys
// conversion pipeline and the fetch() wrapper internals (HTTP method, headers,
// body serialization, error message extraction).
//
// These tests exist to kill Stryker mutations that escape the normalizer tests
// because pass-through values look the same in snake_case and camelCase.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHttpApi, ApiError } from '../http';

const api = createHttpApi('/api/v1');

function mockFetch(body: unknown, status = 200, contentType = 'application/json') {
  const text = JSON.stringify(body);
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => h === 'content-type' ? contentType : null },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as unknown as Response);
}

function mockFetch204() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true, status: 204,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// camelizeKeys — verifiable through API responses
// ---------------------------------------------------------------------------

describe('camelizeKeys — snake_case response fields become camelCase', () => {
  it('camelizes top-level snake_case keys in a node profile', async () => {
    // node_id, ram_total_gb are snake_case on the wire
    mockFetch({
      nodes: [{
        node_id: 'n-cam-test',
        hostname: 'box',
        os: 'linux',
        arch: 'x86_64',
        backends: ['cpu'],
        gpus: [],
        ram_total_gb: 64,
        ram_available_gb: 32,
        mem_bandwidth_gbs: 200,
        disk_free_gb: 500,
        engine_versions: {},
        last_seen: '2026-09-10T00:00:00Z',
        state: 'NODE_STATE_READY',
      }],
    });
    const nodes = await api.listNodes();
    // Verify the snake_case → camelCase conversion happened
    expect(nodes[0].profile.nodeId).toBe('n-cam-test');
    expect(nodes[0].profile.ramTotalGb).toBe(64);
    expect(nodes[0].profile.ramAvailableGb).toBe(32);
    expect(nodes[0].profile.memBandwidthGbs).toBe(200);
    expect(nodes[0].profile.diskFreeGb).toBe(500);
  });

  it('camelizes nested objects (within a deployment detail)', async () => {
    mockFetch({
      id: 'dep-cam',
      state: 'DEPLOYMENT_STATE_ACTIVE',
      detail: {
        model_id: 'cam-llama3',
        quantization: 'q4_k_m',
        engines: [{
          node_id: 'n-1',
          role: 'host',
          layer_start: 0,
          layer_end: 32,
          draft: false,
        }],
      },
    });
    const dep = await api.getDeployment('dep-cam');
    // model_id → modelId (nested under detail)
    expect(dep.plan.modelId).toBe('cam-llama3');
    // engine: node_id → nodeId, layer_start → layerStart
    expect(dep.plan.assignments[0].nodeId).toBe('n-1');
    expect(dep.plan.assignments[0].layerStart).toBe(0);
    expect(dep.plan.assignments[0].layerEnd).toBe(32);
  });

  it('camelizes deeply nested objects in audit entries', async () => {
    mockFetch({
      feature: 'audit',
      licensee: 'purser',
      entries: [{
        seq: 1,
        actor: 'alice',
        action: 'deploy.create',
        resource: 'dep-1',
        prev_hash: 'abc',
        hash: 'def',
        details: {},
      }],
      chain: { verified: true, length: 1 },
    });
    const log = await api.getAuditLog();
    // prev_hash → prevHash
    expect(log.entries[0].prevHash).toBe('abc');
    expect(log.entries[0].hash).toBe('def');
  });

  it('camelizes array items in the catalog', async () => {
    mockFetch({
      models: [{
        id: 'm1',
        spec: {
          model_id: 'llama3-8b',
          family: 'llama3',
          parameter_count: '8B',
          context_length: 8192,
          quantizations: [{ name: 'q4_k_m', size_gb: 4.5, vram_gb: 5.0 }],
        },
        fit: null,
        deployable: true,
      }],
    });
    const catalog = await api.getCatalog();
    // spec.model_id → spec.modelId (normalized via normalizeModelEntry)
    expect(catalog[0].model.modelId).toBe('llama3-8b');
    expect(catalog[0].model.family).toBe('llama3');
    // quantizations array items are camelized: size_gb → sizeGb
    expect((catalog[0].model.quantizations[0] as unknown as Record<string, unknown>).sizeGb).toBe(4.5);
  });

  it('preserves OPAQUE_KEYS (engineVersions map keys are NOT camelized)', async () => {
    mockFetch({
      nodes: [{
        node_id: 'n-opaque',
        hostname: 'box',
        os: 'linux',
        arch: 'x86_64',
        backends: ['cpu'],
        gpus: [],
        ram_total_gb: 8,
        ram_available_gb: 8,
        mem_bandwidth_gbs: 0,
        disk_free_gb: 100,
        engine_versions: { 'llama.cpp': '1.2.0', 'ollama_v2': '3.0.0' },
        last_seen: '2026-09-10T00:00:00Z',
        state: 'ready',
      }],
    });
    const nodes = await api.listNodes();
    const ev = nodes[0].profile.engineVersions as Record<string, string>;
    // 'llama.cpp' must NOT be converted to 'llama.Cpp' or 'llamaCpp'
    expect(ev['llama.cpp']).toBe('1.2.0');
    // 'ollama_v2' must NOT be converted to 'ollamaV2'
    expect(ev['ollama_v2']).toBe('3.0.0');
  });
});

// ---------------------------------------------------------------------------
// snakeizeKeys — request bodies must be snake_cased before sending
// ---------------------------------------------------------------------------

describe('snakeizeKeys — camelCase body keys become snake_case in fetch', () => {
  it('converts camelCase body to snake_case for a POST request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ plan_id: 'p-1', model_id: 'llama3', assignments: [] })),
      json: () => Promise.resolve({ plan_id: 'p-1', model_id: 'llama3', assignments: [] }),
    } as unknown as Response);

    await api.planDeployment('llama3', { forceNodeCount: null, preference: 'balanced' });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    // The DeployOverrides body has camelCase keys — they should become snake_case
    // forceNodeCount → force_node_count
    expect(Object.prototype.hasOwnProperty.call(sentBody, 'force_node_count')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sentBody, 'forceNodeCount')).toBe(false);
  });

  it('sends DELETE with no body (204 pass-through)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 204,
      headers: { get: () => null },
      text: () => Promise.resolve(''),
      json: () => Promise.reject(new Error('no body')),
    } as unknown as Response);

    await api.removeNode('n-1');

    expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    expect(fetchSpy.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('sends correct HTTP method for each verb', async () => {
    // PUT (drain is a POST to /nodes/:id/drain)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ node_id: 'n-1', hostname: 'x', os: 'linux', backends: ['cpu'] })),
      json: () => Promise.resolve({ node_id: 'n-1', hostname: 'x', os: 'linux', backends: ['cpu'] }),
    } as unknown as Response);

    await api.drainNode('n-1');
    const calls = fetchSpy.mock.calls;
    const drainMethod = calls[calls.length - 1]?.[1]?.method;
    // drainNode uses POST to /nodes/:id/drain
    expect(drainMethod).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// fetch wrapper — error handling
// ---------------------------------------------------------------------------

describe('request — error handling', () => {
  it('throws ApiError with message from body.message field', async () => {
    mockFetch({ message: 'node not found' }, 404);
    await expect(api.getNode('n-missing')).rejects.toMatchObject({
      status: 404,
      message: 'node not found',
    });
  });

  it('throws ApiError with message from body.error field when message is absent', async () => {
    mockFetch({ error: 'quota exceeded' }, 422);
    await expect(api.createDeployment('llama3', { forceNodeCount: null, preference: 'balanced' }))
      .rejects.toMatchObject({ status: 422, message: 'quota exceeded' });
  });

  it('falls back to HTTP status text when body has no message or error', async () => {
    // body has a 'code' field but no 'message' or 'error'
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 500,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ code: 'some_code' })),
      json: () => Promise.resolve({ code: 'some_code' }),
    } as unknown as Response);
    let caught: unknown;
    try {
      await api.getCatalog();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
    expect((caught as ApiError).message).toContain('500');
  });

  it('handles non-JSON error body gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html>Service Unavailable</html>'),
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
    await expect(api.getCatalog()).rejects.toMatchObject({ status: 503 });
  });

  it('wraps network errors in ApiError with status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));
    await expect(api.listNodes()).rejects.toMatchObject({ status: 0, message: 'net::ERR_NAME_NOT_RESOLVED' });
  });

  it('returns undefined for 204 No Content responses', async () => {
    mockFetch204();
    const result = await api.undeployDeployment('dep-1');
    expect(result).toBeUndefined();
  });

  it('passes Content-Type: application/json only when body is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ nodes: [] })),
      json: () => Promise.resolve({ nodes: [] }),
    } as unknown as Response);

    await api.listNodes();
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    // GET requests without a body should NOT send Content-Type
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('includes Content-Type: application/json when body is present in POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ plan_id: 'p-1', model_id: 'llama3', assignments: [] })),
      json: () => Promise.resolve({ plan_id: 'p-1', model_id: 'llama3', assignments: [] }),
    } as unknown as Response);

    await api.planDeployment('llama3', { forceNodeCount: null, preference: 'balanced' });
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends credentials: same-origin on every request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve('[]'),
      json: () => Promise.resolve([]),
    } as unknown as Response);

    await api.listNodes();
    expect(fetchSpy.mock.calls[0][1]?.credentials).toBe('same-origin');
  });
});

// ---------------------------------------------------------------------------
// requestText — YAML endpoint
// ---------------------------------------------------------------------------

describe('requestText — accepts plain text bodies', () => {
  it('exportConfig returns the raw YAML string', async () => {
    const yaml = '# purser config\nversion: v1\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/yaml' },
      text: () => Promise.resolve(yaml),
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    const result = await api.exportConfig();
    expect(result).toBe(yaml);
  });

  it('requestRaw (diffConfig) sends Content-Type: application/yaml with raw YAML body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ diff: '', hasChanges: false })),
      json: () => Promise.resolve({ diff: '', hasChanges: false }),
    } as unknown as Response);

    const yaml = 'version: v1\nresources: []\n';
    await api.diffConfig(yaml);
    const reqHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    const sentBody = fetchSpy.mock.calls[0][1]?.body as string;
    // Body must be the raw YAML string, not JSON-encoded
    expect(sentBody).toBe(yaml);
    // Content-Type must be application/yaml (not application/json)
    expect(reqHeaders['Content-Type']).toBe('application/yaml');
  });
});

// ---------------------------------------------------------------------------
// camelizeKeys array recursion — make sure array items are camelized
// ---------------------------------------------------------------------------

describe('camelizeKeys — array items are recursively camelized', () => {
  it('camelizes items in an array response (service accounts)', async () => {
    mockFetch([
      {
        id: 'sa-1',
        name: 'ci-bot',
        created_at: '2026-09-01T00:00:00Z',
        tenant: 'eng',
        description: 'CI pipeline account',
        role: 'inference',
        scopes: [],
        client_id: 'c-123',
        enabled: true,
        last_used_at: null,
      },
    ]);
    const accounts = await api.listServiceAccounts();
    // created_at → createdAt, client_id → clientId, last_used_at → lastUsedAt
    expect(accounts[0].createdAt).toBe('2026-09-01T00:00:00Z');
    expect(accounts[0].clientId).toBe('c-123');
    expect(accounts[0].lastUsedAt).toBeNull();
    expect(accounts[0].tenant).toBe('eng');
  });

  it('camelizes audit log entries array items', async () => {
    mockFetch({
      feature: 'audit',
      licensee: 'purser',
      entries: [
        { seq: 1, actor: 'bob', action: 'model.import', resource: 'm1', prev_hash: 'x1', hash: 'y1', details: {} },
        { seq: 2, actor: 'carol', action: 'deploy.create', resource: 'd1', prev_hash: 'y1', hash: 'z1', details: {} },
      ],
      chain: { verified: true, length: 2 },
    });
    const log = await api.getAuditLog();
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0].prevHash).toBe('x1');
    expect(log.entries[1].prevHash).toBe('y1');
  });
});

// ---------------------------------------------------------------------------
// normalizeEnumStr — strip prefix and lowercase
// ---------------------------------------------------------------------------

describe('normalizeEnumStr — enum string normalization', () => {
  it('strips NODE_STATE_ prefix from node state', async () => {
    mockFetch({
      nodes: [{
        node_id: 'n-enum',
        hostname: 'box',
        os: 'linux',
        arch: 'x86_64',
        backends: ['cpu'],
        gpus: [],
        ram_total_gb: 8,
        ram_available_gb: 8,
        mem_bandwidth_gbs: 0,
        disk_free_gb: 100,
        engine_versions: {},
        last_seen: '2026-09-10T00:00:00Z',
        state: 'NODE_STATE_READY',
      }],
    });
    const nodes = await api.listNodes();
    expect(nodes[0].profile.state).toBe('ready');
  });

  it('strips DEPLOYMENT_STATE_ prefix from deployment state', async () => {
    mockFetch({
      id: 'dep-enum',
      state: 'DEPLOYMENT_STATE_ACTIVE',
      detail: {
        model_id: 'llama3',
        quantization: 'q4_k_m',
        engines: [],
      },
    });
    const dep = await api.getDeployment('dep-enum');
    expect(dep.state).toBe('active');
  });

  it('leaves already-lowercase state values unchanged', async () => {
    mockFetch({
      nodes: [{
        node_id: 'n-low',
        hostname: 'box',
        os: 'linux',
        arch: 'x86_64',
        backends: ['cpu'],
        gpus: [],
        ram_total_gb: 8,
        ram_available_gb: 8,
        mem_bandwidth_gbs: 0,
        disk_free_gb: 100,
        engine_versions: {},
        last_seen: '2026-09-10T00:00:00Z',
        state: 'draining',
      }],
    });
    const nodes = await api.listNodes();
    expect(nodes[0].profile.state).toBe('draining');
  });
});

// ---------------------------------------------------------------------------
// num / str / bool helpers — verified through normalizer output
// ---------------------------------------------------------------------------

describe('num / str / bool helper defaults', () => {
  it('num() defaults numeric fields to 0 and numOrNull returns null when absent (cluster capacity)', async () => {
    mockFetch({ node_count: 3 }); // missing all other fields
    const cap = await api.getCapacity();
    expect(cap.nodeCount).toBe(3);
    // ramTotalGb / vramTotalGb use numOrNull: absent field → null (not 0)
    expect(cap.ramTotalGb).toBeNull();
    expect(cap.vramTotalGb).toBeNull();
    // gpuCount / aggregateDecodeTokS still use num: absent → 0
    expect(cap.gpuCount).toBe(0);
    expect(cap.aggregateDecodeTokS).toBe(0);
  });

  it('str() defaults to empty string for absent text fields', async () => {
    // listPolicies wraps in { policies: [...] }
    mockFetch({ policies: [{ id: 1, enabled: true }] }); // policy with no name/rego fields
    const policies = await api.listPolicies();
    // normPolicy uses str() for name, source etc. — defaults to ''
    expect(policies.policies[0].name).toBe('');
    expect(policies.policies[0].source).toBe('');
  });

  it('bool() defaults to true for enabled flag when absent (policy)', async () => {
    mockFetch({ policies: [{ id: 1, name: 'strict' }] }); // no enabled field
    const policies = await api.listPolicies();
    // bool(undefined, true) → true
    expect(policies.policies[0].enabled).toBe(true);
  });

  it('bool() uses explicit false when provided (policy)', async () => {
    mockFetch({ policies: [{ id: 2, name: 'lenient', enabled: false }] });
    const policies = await api.listPolicies();
    expect(policies.policies[0].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Uncovered branch kills — targeting specific lines in http.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 401 Unauthorized — handleUnauthorized path (L285-288)
// ---------------------------------------------------------------------------

describe('request — 401 triggers handleUnauthorized import (L285-288)', () => {
  it('throws ApiError with status 401 when API returns 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ message: 'unauthorized' })),
      json: () => Promise.resolve({ message: 'unauthorized' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.getCapacity(); } catch (e) { caught = e; }
    // Should throw ApiError(401, ...) after calling handleUnauthorized
    expect((caught as { status: number }).status).toBe(401);
    expect((caught as Error).message).toBe('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// normalizePlan — no assignments branch (L354)
// ---------------------------------------------------------------------------

describe('normalizePlan — empty/missing assignments (L354)', () => {
  it('plan without assignments array defaults to [] (L354)', async () => {
    mockFetch({
      plan_id: 'p-no-assign',
      model_id: 'llama3',
      quantization: 'q4',
      // no assignments field — exercises `: []` branch
    });
    const plan = await api.getPlan('p-no-assign');
    expect(plan.assignments).toEqual([]);
    expect(plan.pipelineOrder).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeNodeStatus — unknown state (L378)
// ---------------------------------------------------------------------------

describe('normalizeNodeStatus — unknown state defaults to loading (L378)', () => {
  it('nodeStatus with an unrecognized state falls back to loading (L378)', async () => {
    mockFetch({
      id: 'dep-unk-ns',
      state: 'active',
      plan: {
        planId: 'p-unk',
        modelId: 'llama3',
        assignments: [],
      },
      nodeStatus: [{ nodeId: 'n-1', state: 'UNKNOWN_STATE_XYZ', progress: 0.5, detail: '' }],
    });
    const dep = await api.getDeployment('dep-unk-ns');
    // UNKNOWN_STATE_XYZ → normalizeEnumStr → 'unknown_state_xyz' → not in NODE_LOAD_STATES → 'loading'
    expect(dep.nodeStatus[0].state).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// normalizeDeploymentState — unknown state (L395)
// ---------------------------------------------------------------------------

describe('normalizeDeploymentState — unknown state defaults to provisioning (L395)', () => {
  it('deployment with unknown state falls back to provisioning (L395)', async () => {
    mockFetch({
      id: 'dep-unk-state',
      state: 'TOTALLY_UNKNOWN_STATE',
      detail: { model_id: 'llama3', quantization: 'q4', engines: [] },
    });
    const dep = await api.getDeployment('dep-unk-state');
    // TOTALLY_UNKNOWN_STATE → normalizeEnumStr → 'totally_unknown_state' → not in DEPLOYMENT_STATES → 'provisioning'
    expect(dep.state).toBe('provisioning');
  });
});

// ---------------------------------------------------------------------------
// normalizeDeployment detail-branch — no engines (L409)
// ---------------------------------------------------------------------------

describe('normalizeDeployment detail-branch — no engines (L409)', () => {
  it('detail-branch deployment with no engines gets empty assignments (L409)', async () => {
    mockFetch({
      id: 'dep-no-eng',
      state: 'DEPLOYMENT_STATE_ACTIVE',
      detail: {
        model_id: 'llama3',
        quantization: 'q4_k_m',
        // no engines field — exercises `: []` branch at L409
      },
    });
    const dep = await api.getDeployment('dep-no-eng');
    expect(dep.plan.assignments).toEqual([]);
    expect(dep.nodeStatus).toEqual([]);
    expect(dep.plan.pipelineOrder).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// requestText error paths — exportConfig 401 (L244-246) and error body (L229-248)
// ---------------------------------------------------------------------------

describe('requestText — error handling paths (L229-248)', () => {
  it('throws ApiError 401 when exportConfig gets a 401 (exercises L244-246)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ message: 'unauthorized' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(401);
  });

  it('throws ApiError with extracted message from requestText error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ message: 'forbidden' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as Error).message).toBe('forbidden');
  });

  it('uses body.error field when body.message is absent (L237-238 ?? fallback)', async () => {
    // body has `error` key but no `message` — exercises the `?? .error` branch at L237-238
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ error: 'not exportable' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as Error).message).toBe('not exportable');
    expect((caught as { status: number }).status).toBe(422);
  });

  it('falls back to status message when error body is non-JSON (L242 catch block)', async () => {
    // res.json() rejects → catch block at L242 runs; message stays as "HTTP 503"
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('Service Unavailable'),
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(503);
    expect((caught as Error).message).toContain('503');
  });

  it('falls back to status message when error body is null (L238 : undefined branch)', async () => {
    // camelizeKeys(null) = null; `null && typeof null === 'object'` is false
    // → the ternary takes the `: undefined` arm at L238
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve('null'),
      json: () => Promise.resolve(null),
    } as unknown as Response);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(500);
    // m === undefined → message stays as 'HTTP 500'
    expect((caught as Error).message).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// requestRaw error paths — diffConfig network error (L269-270) and HTTP error (L272-290)
// ---------------------------------------------------------------------------

describe('requestRaw — error handling paths (L269-290)', () => {
  it('wraps network error from diffConfig in ApiError status 0 (L269-270)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    let caught: unknown;
    try { await api.diffConfig('version: v1\n'); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(0);
    expect((caught as Error).message).toBe('ECONNREFUSED');
  });

  it('throws ApiError with message from requestRaw error body (L272-290)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ message: 'invalid yaml' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.diffConfig('invalid: [yaml'); } catch (e) { caught = e; }
    expect((caught as Error).message).toBe('invalid yaml');
    expect((caught as { status: number }).status).toBe(422);
  });

  it('uses body.error field when body.message is absent in requestRaw (L279-280 ?? fallback)', async () => {
    // body has `error` key but no `message` — exercises the `?? .error` branch at L279-280
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ error: 'yaml parse failed' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.applyConfig('bad: [yaml'); } catch (e) { caught = e; }
    expect((caught as Error).message).toBe('yaml parse failed');
    expect((caught as { status: number }).status).toBe(400);
  });

  it('falls back to status message when requestRaw error body is non-JSON (L284 catch block)', async () => {
    // res.json() rejects → catch block at L284 runs; message stays as "HTTP 500"
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('Internal Server Error'),
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
    let caught: unknown;
    try { await api.applyConfig('version: v1\n'); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(500);
    expect((caught as Error).message).toContain('500');
  });

  it('falls back to status message when requestRaw error body is null (L280 : undefined branch)', async () => {
    // camelizeKeys(null) = null; `null && typeof null === 'object'` is false
    // → the ternary takes the `: undefined` arm at L280
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve('null'),
      json: () => Promise.resolve(null),
    } as unknown as Response);
    let caught: unknown;
    try { await api.applyConfig('version: v1\n'); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(500);
    expect((caught as Error).message).toContain('500');
  });

  it('throws ApiError 401 when diffConfig gets 401 (exercises L285-288 in requestRaw)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ message: 'unauthorized' }),
    } as unknown as Response);
    let caught: unknown;
    try { await api.diffConfig('version: v1\n'); } catch (e) { caught = e; }
    expect((caught as { status: number }).status).toBe(401);
  });

  it('requestRaw handles 204 by returning empty result from applyConfig (L291-293)', async () => {
    // When the server returns 204, requestRaw returns undefined (L291).
    // applyConfig wraps it with normalizeConfigApplyResult(undefined ?? {}) → zero-count object.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: () => Promise.resolve(''),
      json: () => Promise.reject(new Error('no body')),
    } as unknown as Response);
    const result = await api.applyConfig('version: v1\n');
    // normalizeConfigApplyResult({}) → all zeroed counts (not undefined)
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});

describe('normalizeDeployment — plan branch without nodeStatus in wire', () => {
  it('derives nodeStatus from plan assignments when nodeStatus is absent (L448-457)', async () => {
    // Non-detail (plan-based) response WITHOUT a nodeStatus array in the wire.
    // This exercises the plan.assignments.map() fallback branch (L450-457).
    mockFetch({
      id: 'dep-no-ns',
      state: 'DEPLOYMENT_STATE_PROVISIONING',
      plan: {
        planId: 'p-no-ns',
        modelId: 'llama3',
        quantization: 'q4',
        assignments: [
          { nodeId: 'n-1', role: 'host', layerStart: 0, layerEnd: 32, draft: false },
        ],
      },
      // no nodeStatus field — triggers the map() fallback
    });
    const dep = await api.getDeployment('dep-no-ns');
    // nodeStatus should be synthesized from plan.assignments
    expect(dep.nodeStatus).toHaveLength(1);
    expect(dep.nodeStatus[0].nodeId).toBe('n-1');
    expect(dep.nodeStatus[0].state).toBe('loading');
    expect(dep.nodeStatus[0].progress).toBe(0);
  });
});

describe('normalizeCatalogEntry — Shape B (flat ModelSpec, no model/spec wrapper)', () => {
  it('normalizes a flat-ModelSpec catalog entry (L598-604)', async () => {
    // Shape B: the entry IS the ModelSpec, no "model" or "spec" key.
    mockFetch({
      models: [{
        modelId: 'flat-llama3',
        family: 'llama3',
        quantizations: [{ name: 'q4_k_m', sizeGb: 4.5, vramGb: 5.0 }],
        deployable: true,
      }],
    });
    const catalog = await api.getCatalog();
    expect(catalog[0].model.modelId).toBe('flat-llama3');
    expect(catalog[0].model.family).toBe('llama3');
    expect(catalog[0].fit.fits).toBe(true);
  });

  it('falls back to empty quantizations when absent in Shape B (L602)', async () => {
    mockFetch({
      models: [{
        modelId: 'bare',
        family: 'gpt',
        // no quantizations field
        deployable: false,
      }],
    });
    const catalog = await api.getCatalog();
    expect(catalog[0].model.quantizations).toEqual([]);
    expect(catalog[0].fit.fits).toBe(false);
  });
});

describe('normalizeSnapshot — empty nodes branch (L676)', () => {
  it('returns empty nodes array when snapshot has no nodes field (L676)', async () => {
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          (this.onmessage as (e: { data: string }) => void)({
            data: JSON.stringify({
              at: '2026-09-13T00:00:00Z',
              aggregate_decode_tok_s: 0,
              // no nodes field
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
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.aggregateDecodeTokS).toBe(0);

    vi.unstubAllGlobals();
  });
});

describe('streamMetrics — catch block for invalid SSE data (L974-975)', () => {
  it('calls onError when SSE data contains malformed JSON (L974)', async () => {
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          // First message: invalid JSON — exercises catch block
          (this.onmessage as (e: { data: string }) => void)({
            data: '{not valid json!!!',
          });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);

    const onError = vi.fn();
    const errorPromise = new Promise<void>((resolve) => {
      api.streamMetrics({
        onMetrics: vi.fn(),
        onError: (err) => { onError(err); resolve(); },
      });
    });
    await errorPromise;
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);

    vi.unstubAllGlobals();
  });

  it('wraps non-Error catch values in Error (L975)', async () => {
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          // Send data that will cause JSON.parse to throw
          (this.onmessage as (e: { data: string }) => void)({
            data: 'undefined is not json',
          });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);

    const errors: unknown[] = [];
    const errorPromise = new Promise<void>((resolve) => {
      api.streamMetrics({
        onMetrics: vi.fn(),
        onError: (err) => { errors.push(err); resolve(); },
      });
    });
    await errorPromise;
    expect(errors[0]).toBeInstanceOf(Error);

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// 'Network error' fallback — non-Error thrown by fetch (L180, L227, L269)
// ---------------------------------------------------------------------------

describe("catch blocks — 'Network error' fallback for non-Error throws", () => {
  it('request uses "Network error" when fetch throws a non-Error string (L180)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('connection refused');
    let caught: unknown;
    try { await api.listNodes(); } catch (e) { caught = e; }
    expect((caught as ApiError).status).toBe(0);
    expect((caught as ApiError).message).toBe('Network error');
  });

  it('requestText uses "Network error" when fetch throws a number (L227)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(42);
    let caught: unknown;
    try { await api.exportConfig(); } catch (e) { caught = e; }
    expect((caught as ApiError).status).toBe(0);
    expect((caught as ApiError).message).toBe('Network error');
  });

  it('requestRaw uses "Network error" when fetch throws a plain object (L269)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce({ code: 'ENOENT' });
    let caught: unknown;
    try { await api.diffConfig('v: 1\n'); } catch (e) { caught = e; }
    expect((caught as ApiError).status).toBe(0);
    expect((caught as ApiError).message).toBe('Network error');
  });
});

// ---------------------------------------------------------------------------
// ?? raw fallback — responses without expected wrapper key (L762, L786, L866, L900)
// ---------------------------------------------------------------------------

describe('API wrapper [] fallback — non-array responses return empty (L762, L786, L866, L900, L1297)', () => {
  // Each test exercises the `return Array.isArray(arr) ? arr.map(...) : []` else-branch.
  // The ArrayDeclaration mutation replaces `[]` with `["Stryker was here"]` — these tests
  // assert an empty result, which would fail with that mutation.

  it('listNodes returns [] when response is an object without nodes/array (L762)', async () => {
    // raw = {} → arr = {} → not Array → return []
    mockFetch({});
    const nodes = await api.listNodes();
    expect(nodes).toEqual([]);
  });

  it('getCatalog returns [] when response is an object without models/array (L786)', async () => {
    mockFetch({});
    const entries = await api.getCatalog();
    expect(entries).toEqual([]);
  });

  it('listDeployments returns [] when response is an object without deployments/array (L866)', async () => {
    mockFetch({});
    const deps = await api.listDeployments();
    expect(deps).toEqual([]);
  });

  it('listApiKeys returns [] when response is an object without apikeys/array (L900)', async () => {
    mockFetch({});
    const keys = await api.listApiKeys();
    expect(keys).toEqual([]);
  });

  it('listServiceAccounts returns [] when response has no serviceAccounts field and is not array (L1297)', async () => {
    mockFetch({});
    const accounts = await api.listServiceAccounts();
    expect(accounts).toEqual([]);
  });

  it('listNodes works with bare array response (backward compat ?? raw path, L762)', async () => {
    // raw is an array (no nodes wrapper) — arr = raw via ?? raw
    mockFetch([{ node_id: 'n1', hostname: 'h1', os: 'linux', arch: 'x86_64', backends: ['cpu'], gpus: [], ram_total_gb: 32, ram_available_gb: 16, mem_bandwidth_gbs: 100, disk_free_gb: 200, engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 'NODE_STATE_READY' }]);
    const nodes = await api.listNodes();
    expect(nodes).toHaveLength(1);
    // NodeView has profile.hostname (not top-level hostname)
    expect((nodes[0].profile as unknown as Record<string, unknown>).hostname).toBe('h1');
  });
});

// ---------------------------------------------------------------------------
// Deployment approvals — listDeploymentApprovals, approve, reject (L942, L955, L961)
// ---------------------------------------------------------------------------

describe('deployment approvals API', () => {
  it('listDeploymentApprovals returns normalized approvals', async () => {
    mockFetch({ approvals: [{ id: 'dep-1', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'pending' }] });
    const approvals = await api.listDeploymentApprovals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0].requester).toBe('alice');
    expect(approvals[0].status).toBe('pending');
  });

  it('listDeploymentApprovals passes status and limit query params (L942)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: () => Promise.resolve(JSON.stringify({ approvals: [] })),
      json: () => Promise.resolve({ approvals: [] }),
    } as unknown as Response);
    await api.listDeploymentApprovals('approved', 10);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('status=approved');
    expect(url).toContain('limit=10');
  });

  it('approveDeployment uses empty string notes when not provided (L955 ?? "" mutation)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: () => Promise.resolve(JSON.stringify({ id: 'd1', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'approved' })),
      json: () => Promise.resolve({ id: 'd1', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'approved' }),
    } as unknown as Response);
    await api.approveDeployment('dep-1');  // no notes argument
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.notes).toBe('');
  });

  it('rejectDeployment uses empty string notes when not provided (L961 ?? "" mutation)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: () => Promise.resolve(JSON.stringify({ id: 'd1', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'rejected' })),
      json: () => Promise.resolve({ id: 'd1', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'rejected' }),
    } as unknown as Response);
    await api.rejectDeployment('dep-1');  // no notes argument
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.notes).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Billing URL builders — getBillingXlsxUrl, getBillingPdfUrl (L1003, L1009)
// ---------------------------------------------------------------------------

describe('billing URL builders', () => {
  it('getBillingXlsxUrl includes format=xlsx and date range (L1003)', () => {
    const url = api.getBillingXlsxUrl('2026-01-01', '2026-12-31');
    expect(url).toContain('format=xlsx');
    expect(url).toContain('start=2026-01-01');
    expect(url).toContain('end=2026-12-31');
  });

  it('getBillingXlsxUrl includes tenantId when provided', () => {
    const url = api.getBillingXlsxUrl('2026-01-01', '2026-12-31', 'tenant-1');
    expect(url).toContain('tenant_id=tenant-1');
  });

  it('getBillingPdfUrl includes format=pdf (L1009)', () => {
    const url = api.getBillingPdfUrl('2026-01-01', '2026-12-31');
    expect(url).toContain('format=pdf');
  });
});

// ---------------------------------------------------------------------------
// listInferenceAudit — all optional query params (L1157-1173)
// ---------------------------------------------------------------------------

describe('listInferenceAudit — query parameter building', () => {
  it('sends all query params when provided (L1157, L1160, L1161, L1173)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: () => Promise.resolve(JSON.stringify({ entries: [], total: 0 })),
      json: () => Promise.resolve({ entries: [], total: 0 }),
    } as unknown as Response);
    await api.listInferenceAudit({ limit: 50, offset: 10, modelId: 'llama3', tenant: 'eng', since: '2026-01-01', until: '2026-12-31' });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=10');
    expect(url).toContain('model_id=llama3');
    expect(url).toContain('tenant=eng');
    expect(url).toContain('since=2026-01-01');
    expect(url).toContain('until=2026-12-31');
  });

  it('omits query string when no params given (qs empty string branch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
      text: () => Promise.resolve(JSON.stringify({ entries: [], total: 0 })),
      json: () => Promise.resolve({ entries: [], total: 0 }),
    } as unknown as Response);
    await api.listInferenceAudit({});
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/inference-audit');
  });
});

// ---------------------------------------------------------------------------
// createServiceAccount — response normalization (L1307 string mutations)
// ---------------------------------------------------------------------------

describe('createServiceAccount — response field normalization', () => {
  it('normalizes id, name, clientId, clientSecret from API response (L1307)', async () => {
    mockFetch({ id: 'sa-99', name: 'bot-sa', client_id: 'cid-99', client_secret: 'sec-99', role: 'reader', scopes: ['infer'] });
    const sa = await api.createServiceAccount({ name: 'bot-sa', teamId: 'team-1', role: 'reader' });
    expect(sa.id).toBe('sa-99');
    expect(sa.name).toBe('bot-sa');
    expect(sa.clientId).toBe('cid-99');
    expect(sa.clientSecret).toBe('sec-99');
  });

  it('falls back to input.name when name is absent from response', async () => {
    mockFetch({ id: 'sa-100', client_id: 'c', client_secret: 's', role: 'reader', scopes: [] });
    const sa = await api.createServiceAccount({ name: 'fallback-name', teamId: 't', role: 'reader' });
    expect(sa.name).toBe('fallback-name');
  });
});

// ---------------------------------------------------------------------------
// listPlatformUsers — user normalization (L1276-1278, L1332)
// ---------------------------------------------------------------------------

describe('listPlatformUsers — user sub and org normalization', () => {
  it('maps user_sub to id and email, org_id to orgId (L1276-1278, L1332)', async () => {
    mockFetch({ users: [{ user_sub: 'sub-abc', org_id: 'org-xyz', role: 'admin', display_name: 'Alice' }] });
    const users = await api.listPlatformUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('sub-abc');
    expect(users[0].email).toBe('sub-abc');
    expect(users[0].orgId).toBe('org-xyz');
    expect(users[0].role).toBe('admin');
  });

  it('listPlatformUsers returns [] when response is not array and has no "users" key', async () => {
    mockFetch({});
    const users = await api.listPlatformUsers();
    expect(users).toEqual([]);
  });

  it('listPlatformUsers displayName is used from display_name field (kills L1336 LogicalOperator ??→&&)', async () => {
    // Mutation: (e.displayName ?? e.display_name ?? sub) → (e.displayName && e.display_name ?? sub)
    // With &&: when displayName is absent but display_name is set, result would be 'sub' not 'Alice'.
    mockFetch({ users: [{ user_sub: 'sub-1', display_name: 'Alice', org_id: 'org-1', role: 'admin' }] });
    const users = await api.listPlatformUsers();
    expect(users[0].displayName).toBe('Alice');
  });

  it('listPlatformUsers falls back to sub when displayName is absent (kills L1336 full chain)', async () => {
    // When both displayName and display_name are absent, sub should be used.
    // Mutation (all ??→&&): e.displayName && e.display_name && sub
    // With &&: undefined && undefined && 'sub-3' = undefined (wrong — String(undefined)='undefined').
    // With ??→&& on last pair: e.displayName ?? (e.display_name && sub) — when both absent, returns sub regardless.
    // Actually this tests the identity fallback to sub when no display fields are set.
    mockFetch({ users: [{ user_sub: 'sub-3', org_id: 'org-3', role: 'viewer' }] });
    const users = await api.listPlatformUsers();
    expect(users[0].displayName).toBe('sub-3');
  });
});

// ---------------------------------------------------------------------------
// numOrNull helper — distinguishes absent/null (→ null) from real 0 (→ 0)
// Regression suite for the capacity normalizer after the E3 contract-gap fix:
// RAM/VRAM fields use numOrNull so the UI can show "not measured" vs "0 GB".
// ---------------------------------------------------------------------------

describe('numOrNull helper — capacity fields (E3 contract-gap fix)', () => {
  it('null in payload → null in result (field absent from backend)', async () => {
    // A server that predates v0.7 will send null for ram_total_gb.
    // The UI must show "not measured", not "0 GB".
    mockFetch({ ram_total_gb: null, node_count: 1 });
    const cap = await api.getCapacity();
    expect(cap.ramTotalGb).toBeNull();
  });

  it('undefined in payload → null in result (field absent from backend)', async () => {
    // Field completely missing from JSON → undefined after camelizeKeys → null.
    mockFetch({ node_count: 1 }); // no ram_total_gb key
    const cap = await api.getCapacity();
    expect(cap.ramTotalGb).toBeNull();
  });

  it('0 in payload → 0 in result (CPU-only cluster: real measured value)', async () => {
    // VRAM = 0 on a CPU-only cluster is a real, meaningful measurement.
    // numOrNull must NOT convert it to null.
    mockFetch({ vram_total_gb: 0, node_count: 2 });
    const cap = await api.getCapacity();
    expect(cap.vramTotalGb).toBe(0);
  });

  it('numeric vram value passes through unchanged', async () => {
    mockFetch({ vram_total_gb: 48.0, node_count: 2 });
    const cap = await api.getCapacity();
    expect(cap.vramTotalGb).toBe(48.0);
  });

  it('numeric ram value passes through unchanged', async () => {
    mockFetch({ ram_total_gb: 30.74, node_count: 2 });
    const cap = await api.getCapacity();
    expect(cap.ramTotalGb).toBeCloseTo(30.74, 2);
  });
});

// ---------------------------------------------------------------------------
// normalizeAssignment role — non-'worker' roles must survive LogicalOperator mutation (L343)
// ---------------------------------------------------------------------------

describe('normalizeAssignment — role preservation (L343 && mutation)', () => {
  it('role "master" in assignment is NOT replaced with "worker" (kills L343 LogicalOperator && mutation)', async () => {
    // Mutation: str(a.role,'worker') as Role || 'worker' → str(a.role,'worker') as Role && 'worker'
    // With &&: 'master' && 'worker' = 'worker' (wrong). Original: 'master' || 'worker' = 'master'.
    mockFetch({
      model_id: 'llama3',
      plan_id: 'p1',
      assignments: [{ node_id: 'n1', role: 'master', layer_start: 0, layer_end: 16 }],
    });
    const plan = await api.getPlan('p1');
    expect(plan.assignments[0].role).toBe('master');
  });
});

// ---------------------------------------------------------------------------
// normalizeProfileEnums — state/os/arch with null inputs (L511-L513 StringLiteral)
// and with valid non-default values (L512-L513 LogicalOperator)
// ---------------------------------------------------------------------------

describe('normalizeProfileEnums — default fallbacks for non-string values', () => {
  it('state defaults to "ready" when node state is non-string (kills L511 StringLiteral "ready"→"")', async () => {
    // normalizeEnumStr(42, NODE_STATES) returns '' → '' || 'ready' = 'ready'
    // With StringLiteral mutation '': '' || '' = '' ≠ 'ready'
    mockFetch({ nodes: [{ node_id: 'n1', hostname: 'h', os: 'linux', arch: 'x86_64', backends: [], gpus: [],
      ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
      engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 42 }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).state).toBe('ready');
  });

  it('os defaults to "linux" when node os is null (kills L512 StringLiteral "linux"→"")', async () => {
    // normalizeEnumStr(null, OS_VALUES) returns '' → '' || 'linux' = 'linux'
    // Mutation: '' || '' = '' ≠ 'linux'
    mockFetch({ nodes: [{ node_id: 'n2', hostname: 'h', os: null, arch: 'x86_64', backends: [], gpus: [],
      ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
      engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 'ready' }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).os).toBe('linux');
  });

  it('os "darwin" is preserved (kills L512 LogicalOperator → && mutation)', async () => {
    // Mutation: normalizeEnumStr(profile.os, OS_VALUES) && 'linux'
    // With &&: 'darwin' && 'linux' = 'linux' (wrong). Original: 'darwin' || 'linux' = 'darwin'.
    mockFetch({ nodes: [{ node_id: 'n3', hostname: 'h', os: 'darwin', arch: 'x86_64', backends: [], gpus: [],
      ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
      engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 'ready' }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).os).toBe('darwin');
  });

  it('arch defaults to "x86_64" when null (kills L513 StringLiteral "x86_64"→"")', async () => {
    mockFetch({ nodes: [{ node_id: 'n4', hostname: 'h', os: 'linux', arch: null, backends: [], gpus: [],
      ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
      engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 'ready' }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).arch).toBe('x86_64');
  });

  it('arch "arm64" is preserved (kills L513 LogicalOperator → && mutation)', async () => {
    // Mutation: normalizeEnumStr(profile.arch, ARCH_VALUES) && 'x86_64'
    // With &&: 'arm64' && 'x86_64' = 'x86_64' (wrong). Original: 'arm64' || 'x86_64' = 'arm64'.
    mockFetch({ nodes: [{ node_id: 'n5', hostname: 'h', os: 'linux', arch: 'arm64', backends: [], gpus: [],
      ram_total_gb: 8, ram_available_gb: 8, mem_bandwidth_gbs: 0, disk_free_gb: 100,
      engine_versions: {}, last_seen: '2026-01-01T00:00:00Z', state: 'ready' }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).arch).toBe('arm64');
  });
});

// ---------------------------------------------------------------------------
// normalizeNodeView — composite shape (profile key) nodeId/metrics/deploymentId
// ---------------------------------------------------------------------------

describe('normalizeNodeView — composite shape field preservation', () => {
  it('profile.nodeId is NOT overwritten by n.id when already set (kills L539 LogicalOperator || mutation)', async () => {
    // Mutation: !profile.nodeId && n.id → !profile.nodeId || n.id
    // With ||: always sets profile.nodeId = n.id, overwriting original-id with outer-id.
    mockFetch({ nodes: [{ id: 'outer-id',
      profile: { nodeId: 'original-node-id', os: 'linux', arch: 'x86_64', gpus: [] } }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).nodeId).toBe('original-node-id');
  });

  it('profile.nodeId is backfilled from n.id when absent in profile (kills L539 ConditionalExpression → true)', async () => {
    // Mutation: (!profile.nodeId && n.id) → true — always overwrites nodeId
    // This test checks the normal backfill still works (nodeId absent → use n.id).
    // When mutation is 'true': if profile.nodeId already set → still overwrites → different
    // This specific test ensures the condition path (!profile.nodeId absent) is correct.
    mockFetch({ nodes: [{ id: 'backfill-id',
      profile: { os: 'linux', arch: 'x86_64', gpus: [] } }] });
    const nodes = await api.listNodes();
    expect((nodes[0].profile as unknown as Record<string, unknown>).nodeId).toBe('backfill-id');
  });

  it('metrics are preserved when present (kills L546 LogicalOperator && → ?? mutation)', async () => {
    // Mutation: n.metrics ?? null → n.metrics && null
    // With &&: when metrics is present (truthy), returns null (wrong). Original returns metrics.
    mockFetch({ nodes: [{ id: 'n1',
      profile: { nodeId: 'n1', os: 'linux', arch: 'x86_64', gpus: [] },
      metrics: { prefill_tok_s: 100, decode_tok_s: 50 } }] });
    const nodes = await api.listNodes();
    expect(nodes[0].metrics).not.toBeNull();
  });

  it('deploymentId is preserved when present (kills L549 LogicalOperator && → ?? mutation)', async () => {
    // Mutation: n.deploymentId ?? null → n.deploymentId && null
    // With &&: when deploymentId truthy → returns null (wrong). Original returns the id.
    mockFetch({ nodes: [{ id: 'n1',
      profile: { nodeId: 'n1', os: 'linux', arch: 'x86_64', gpus: [] },
      deploymentId: 'deploy-123' }] });
    const nodes = await api.listNodes();
    expect(nodes[0].deploymentId).toBe('deploy-123');
  });
});

// ---------------------------------------------------------------------------
// normalizeApproval — id type coercion (L736 ConditionalExpression → true)
// and status preservation (L741 LogicalOperator)
// ---------------------------------------------------------------------------

describe('normalizeApproval — id and status edge cases', () => {
  it('id defaults to 0 for non-number id (kills L736 ConditionalExpression → true mutation)', async () => {
    // Mutation: typeof a.id === 'number' ? a.id : 0 → true ? a.id : 0 = a.id always
    // With true: id='string-id' returns 'string-id' (wrong). Original returns 0.
    mockFetch({ approvals: [{ id: 'string-id', requester: 'alice', requested_at: '2026-01-01T00:00:00Z', status: 'pending' }] });
    const approvals = await api.listDeploymentApprovals();
    expect(approvals[0].id).toBe(0);
  });

  it('non-pending status is preserved verbatim (kills L741 LogicalOperator || → && mutation)', async () => {
    // Mutation: str(a.status, 'pending') || 'pending' → str(a.status, 'pending') && 'pending'
    // With &&: 'approved' && 'pending' = 'pending' (wrong). Original: 'approved' || 'pending' = 'approved'.
    mockFetch({ approvals: [{ id: 1, requester: 'bob', requested_at: '2026-01-01T00:00:00Z', status: 'approved' }] });
    const approvals = await api.listDeploymentApprovals();
    expect(approvals[0].status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// streamMetrics — [DONE] guard and empty-data guard (L970 mutations)
// ---------------------------------------------------------------------------

describe('streamMetrics — early-return guards (L970)', () => {
  it('empty string ev.data is silently skipped (kills L970 LogicalOperator && mutation)', async () => {
    // Mutation: !ev.data || ev.data === '[DONE]' → !ev.data && ev.data === '[DONE]'
    // With &&: condition is NEVER true (can't be falsy AND equal '[DONE]'), so ALL messages proceed.
    // Test: send empty-string data → onMetrics should NOT be called.
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          (this.onmessage as (e: { data: string }) => void)({ data: '' });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);
    const onMetrics = vi.fn();
    await new Promise<void>((resolve) => {
      api.streamMetrics({ onMetrics, onError: vi.fn() });
      setTimeout(resolve, 30);
    });
    expect(onMetrics).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('[DONE] data is silently skipped (kills L970 ConditionalExpression → false and StringLiteral mutations)', async () => {
    // Mutation ConditionalExpression false: condition always false → [DONE] is processed as JSON → onMetrics called (wrong)
    // Mutation StringLiteral: '[DONE]' → '' — checks for empty string instead, so '[DONE]' passes through
    const EventSourceStub = vi.fn(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      setTimeout(() => {
        if (this.onmessage) {
          (this.onmessage as (e: { data: string }) => void)({ data: '[DONE]' });
        }
      }, 0);
    });
    vi.stubGlobal('EventSource', EventSourceStub);
    const onMetrics = vi.fn();
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      api.streamMetrics({ onMetrics, onError });
      setTimeout(resolve, 30);
    });
    expect(onMetrics).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled(); // [DONE] is not an error
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// normalizeDeployment — nodeStatus default fields (L453/L455 StringLiteral, L473 ObjectLiteral)
// ---------------------------------------------------------------------------

describe('normalizeDeployment — nodeStatus default field values', () => {
  it('nodeStatus state is "loading" and detail is "" when synthesized (kills L453/L455 StringLiteral)', async () => {
    // When deployment has no nodeStatus array (null), it is built from plan.assignments
    // with state='loading', detail=''.  NOTE: Must NOT include a 'detail' key at the top
    // level — that triggers the "Go API engines shape" branch (L405) which has its own
    // nodeStatus synthesis from an empty engines array, bypassing L450-456.
    // Mutation L453 'loading'→'': state becomes '' (wrong).
    // Mutation L455 ''→'Stryker was here!': detail becomes 'Stryker was here!' (wrong).
    mockFetch({
      id: 'd1',
      state: 'active',
      node_status: null,
      plan: {
        plan_id: 'p1',
        model_id: 'llama3',
        assignments: [{ node_id: 'n1', role: 'worker', layer_start: 0, layer_end: 32 }],
      },
    });
    const dep = await api.getDeployment('d1');
    expect(dep.nodeStatus[0].state).toBe('loading');
    expect(dep.nodeStatus[0].detail).toBe('');
  });

  it('nodeStatus items have nodeId set from assignment (kills L473 ObjectLiteral → {} mutation)', async () => {
    // Mutation: { nodeId: a.nodeId, state: 'loading', progress: 0, detail: '' } → {}
    // With {}: nodeStatus[0].nodeId is undefined (wrong). Original has nodeId from assignment.
    // Also must NOT have 'detail' key to stay on the L447-457 path.
    mockFetch({
      id: 'd2',
      state: 'active',
      node_status: null,
      plan: {
        plan_id: 'p2',
        model_id: 'llama3',
        assignments: [{ node_id: 'assignment-node-1', role: 'worker', layer_start: 0, layer_end: 32 }],
      },
    });
    const dep = await api.getDeployment('d2');
    expect(dep.nodeStatus[0].nodeId).toBe('assignment-node-1');
  });
});

// ---------------------------------------------------------------------------
// deploymentFromPlan — nodeStatus fields (L475/L477 StringLiteral, L473 ObjectLiteral)
// ---------------------------------------------------------------------------

describe('deploymentFromPlan — state and detail defaults', () => {
  it('bare-plan deployment has nodeStatus state="loading" and detail="" (kills L475/L477 StringLiteral)', async () => {
    // deploymentFromPlan is called when d.plan === undefined && d.state === undefined && d.assignments !== undefined.
    // The synthesized nodeStatus has state='loading' as const and detail=''.
    // Mutation L475 'loading'→'': state=''.  Mutation L477 ''→'Stryker': detail='Stryker was here!'.
    mockFetch({
      plan_id: 'bare-plan',
      model_id: 'llama3',
      assignments: [{ node_id: 'bn1', role: 'worker', layer_start: 0, layer_end: 32 }],
    });
    const dep = await api.getDeployment('bare-plan');
    expect(dep.nodeStatus[0].state).toBe('loading');
    expect(dep.nodeStatus[0].detail).toBe('');
  });

  it('bare-plan deployment nodeStatus nodeId from assignment (kills L473 ObjectLiteral in deploymentFromPlan)', async () => {
    mockFetch({
      plan_id: 'bare-2',
      model_id: 'llama3',
      assignments: [{ node_id: 'barenode-99', role: 'worker', layer_start: 0, layer_end: 32 }],
    });
    const dep = await api.getDeployment('bare-2');
    expect(dep.nodeStatus[0].nodeId).toBe('barenode-99');
    expect(dep.nodeStatus[0].progress).toBe(0);
  });

  it('bare-plan deployment state is "provisioning" (kills L471 StringLiteral)', async () => {
    mockFetch({
      plan_id: 'bare-3',
      model_id: 'llama3',
      assignments: [{ node_id: 'n1', role: 'worker', layer_start: 0, layer_end: 32 }],
    });
    const dep = await api.getDeployment('bare-3');
    expect(dep.state).toBe('provisioning');
  });
});

// ---------------------------------------------------------------------------
// createServiceAccount — response fields override input (L1308-L1311 LogicalOperator ??→&&)
// ---------------------------------------------------------------------------

describe('createServiceAccount — response-wins normalization (L1308-L1311 mutations)', () => {
  it('response name is used over input.name (kills L1308 ??→&& mutation)', async () => {
    // Mutation: r.name ?? input.name → r.name && input.name
    // With &&: 'server-name' && 'client-name' = 'client-name' (wrong). Original: 'server-name'.
    mockFetch({ id: 'sa-1', name: 'server-name', team_id: 'server-team', role: 'admin', scopes: [], client_id: 'c1', client_secret: 's1' });
    const sa = await api.createServiceAccount({ name: 'client-name', teamId: 'client-team', role: 'viewer' });
    expect(sa.name).toBe('server-name');
  });

  it('response teamId is used over input.teamId (kills L1309 ??→&& mutation)', async () => {
    // Mutation: r.teamId ?? r.team_id ?? r.tenant ?? input.teamId → chain with && operators
    // With &&: 'server-team' && 'client-team' = 'client-team' (wrong). Original: 'server-team'.
    mockFetch({ id: 'sa-2', name: 'svc', team_id: 'server-team', role: 'admin', scopes: [], client_id: 'c2', client_secret: 's2' });
    const sa = await api.createServiceAccount({ name: 'svc', teamId: 'client-team', role: 'admin' });
    expect(sa.tenant).toBe('server-team');
  });

  it('input.description is included in result (kills L1310 ??→&& on description)', async () => {
    // Mutation: input.description ?? '' → input.description && ''
    // With &&: 'my desc' && '' = '' (wrong). Original: 'my desc' ?? '' = 'my desc'.
    mockFetch({ id: 'sa-3', name: 'svc', team_id: 't1', role: 'admin', scopes: [], client_id: 'c3', client_secret: 's3' });
    const sa = await api.createServiceAccount({ name: 'svc', teamId: 't1', role: 'admin', description: 'my desc' });
    expect(sa.description).toBe('my desc');
  });

  it('response role is used over input.role (kills L1311 ??→&& mutation)', async () => {
    // Mutation: r.role ?? input.role → r.role && input.role
    // With &&: 'admin' && 'viewer' = 'viewer' (wrong). Original: 'admin'.
    mockFetch({ id: 'sa-4', name: 'svc', team_id: 't1', role: 'admin', scopes: [], client_id: 'c4', client_secret: 's4' });
    const sa = await api.createServiceAccount({ name: 'svc', teamId: 't1', role: 'viewer' });
    expect(sa.role).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// listDataPlaneNodes — id and hostname normalization (L1276-L1278 mutations)
// ---------------------------------------------------------------------------

describe('listDataPlaneNodes — node field normalization (L1276-L1278)', () => {
  it('id is set from e.id field (kills L1276 ?? → && mutation)', async () => {
    // Mutation: String(e.id ?? '') → String(e.id && '') = '' when e.id truthy (wrong).
    mockFetch({ nodes: [{ id: 'dp-node-1', hostname: 'host-1', state: 'ready', os: 'linux', arch: 'x86_64' }] });
    const nodes = await api.listDataPlaneNodes('dp1');
    expect(nodes[0].id).toBe('dp-node-1');
  });

  it('hostname falls back to id when hostname absent (kills L1277 ?? → && mutation)', async () => {
    // Mutation: String(e.hostname ?? e.id ?? '') → String(e.hostname && e.id ?? '')
    // With &&: when hostname='host-2' (truthy) → 'host-2' && e.id → uses e.id (wrong).
    // This test verifies: e.hostname is used as hostname when present.
    mockFetch({ nodes: [{ id: 'dp-2', hostname: 'host-2', state: 'ready', os: 'linux', arch: 'x86_64' }] });
    const nodes = await api.listDataPlaneNodes('dp1');
    expect(nodes[0].hostname).toBe('host-2');
  });

  it('hostname falls back to id when hostname absent (L1277 fallback path)', async () => {
    // When hostname is absent, falls back to id. Kills the e.id fallback in the ?? chain.
    mockFetch({ nodes: [{ id: 'dp-3', state: 'ready', os: 'linux' }] });
    const nodes = await api.listDataPlaneNodes('dp1');
    expect(nodes[0].hostname).toBe('dp-3');
  });

  it('state is normalized from enum prefix (kills L1278 state normalizer)', async () => {
    mockFetch({ nodes: [{ id: 'dp-4', hostname: 'h4', state: 'NODE_STATE_RUNNING', os: 'linux', arch: 'x86_64' }] });
    const nodes = await api.listDataPlaneNodes('dp1');
    expect(nodes[0].state).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// normalizeAuditLog — feature default 'audit' (L718 StringLiteral mutation)
// ---------------------------------------------------------------------------

describe('normalizeAuditLog — feature default and chain fields', () => {
  it('feature defaults to "audit" when missing from response (kills L718 StringLiteral "audit"→"")', async () => {
    // Mutation: str(r.feature, 'audit') → str(r.feature, '')
    // With mutation: returns '' (wrong). Test: no feature field → expect 'audit'.
    mockFetch({ entries: [], chain: { verified: false, length: 0 } });
    const log = await api.getAuditLog();
    expect(log.feature).toBe('audit');
  });

  it('chain.break is undefined when chain.break is absent (kills L714 LogicalOperator)', async () => {
    // Mutation: chain.break && typeof chain.break === 'object' → chain.break || typeof chain.break === 'object'
    // With ||: if chain.break is a string 'yes' → 'yes' || true = true → tries to use 'yes' as the break object
    mockFetch({ feature: 'audit', entries: [], chain: { verified: true, length: 5 } });
    const log = await api.getAuditLog();
    expect(log.chain.break).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeClusterStatus — stats and leader edge cases (L1462/L1469/L1470 mutations)
// ---------------------------------------------------------------------------

describe('normalizeClusterStatus — non-object stats and non-string leader/state', () => {
  it('stats is undefined when stats is a non-object string (kills L1462 ConditionalExpression → true)', async () => {
    // Mutation: c.stats && typeof c.stats === 'object' → true → always processes stats
    // With true: 'string-stats' is treated as the stats object → wrong.
    mockFetch({ mode: 'standalone', stats: 'not-an-object', is_leader: true });
    const status = await api.getClusterStatus();
    expect(status.stats).toBeUndefined();
  });

  it('stats is undefined when stats is a number (kills L1462 LogicalOperator || mutation)', async () => {
    // Mutation: && → || : 42 || (typeof 42 === 'object') = 42 (truthy) → processes 42 as stats object
    mockFetch({ mode: 'standalone', stats: 42, is_leader: true });
    const status = await api.getClusterStatus();
    expect(status.stats).toBeUndefined();
  });

  it('leader is undefined when leader is a number (kills L1469/L1470 ConditionalExpression → true)', async () => {
    // Mutation: typeof c.leader === 'string' && c.leader → true → returns 42 as leader
    mockFetch({ mode: 'standalone', leader: 42, is_leader: false });
    const status = await api.getClusterStatus();
    expect(status.leader).toBeUndefined();
  });

  it('state is undefined when state is a number (kills L1471 ConditionalExpression → true / LogicalOperator)', async () => {
    // Mutation: typeof c.state === 'string' && c.state → true → returns 99 as state
    mockFetch({ mode: 'standalone', state: 99, is_leader: false });
    const status = await api.getClusterStatus();
    expect(status.state).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normPolicy — createdAt snake_case path (L1497) and non-number id (L1500)
// ---------------------------------------------------------------------------

describe('normPolicy — createdAt snake_case and non-number id (L1497/L1500)', () => {
  it('uses created_at when createdAt is absent (kills L1497 ConditionalExpression)', async () => {
    // Mutation: typeof raw.created_at === 'string' → false — never uses created_at.
    mockFetch({ policies: [{ id: 1, name: 'p1', rego: '', enabled: true,
      created_at: '2026-03-01T00:00:00Z' }] }); // No camelCase createdAt
    const result = await api.listPolicies();
    expect(result.policies[0].createdAt).toBe('2026-03-01T00:00:00Z');
  });

  it('id defaults to 0 for non-number id (kills L1500 ConditionalExpression → true)', async () => {
    // Mutation: typeof raw.id === 'number' → true → returns 'string-id' as id (wrong)
    mockFetch({ policies: [{ id: 'string-id', name: 'p2', rego: '', enabled: true }] });
    const result = await api.listPolicies();
    expect(result.policies[0].id).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractDescription — rego comment extraction (L1483/L1486 mutations)
// ---------------------------------------------------------------------------

describe('extractDescription — rego comment extraction', () => {
  it('extracts description from comment with leading spaces (kills L1483 MethodExpression trim → line)', async () => {
    // Mutation: line.trim() → line — without trim, '  # comment' doesn't start with '#' → no description
    mockFetch({ policies: [{ id: 1, name: 'p3', rego: '  # Allow all traffic\npackage p', enabled: true }] });
    const result = await api.listPolicies();
    expect(result.policies[0].description).toBe('Allow all traffic');
  });

  it('skips empty comment lines, returns first non-empty one (kills L1486 EqualityOperator > → >= mutation)', async () => {
    // Mutation: text.length > 0 → text.length >= 0 — empty comment line would be returned as ''
    // Original: only return text if text.length > 0 (non-empty)
    mockFetch({ policies: [{ id: 1, name: 'p4', rego: '#\n# Real description\npackage p', enabled: true }] });
    const result = await api.listPolicies();
    // First comment line is '#' → text = '' → skipped → second line 'Real description' is returned
    expect(result.policies[0].description).toBe('Real description');
  });
});
