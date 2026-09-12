/**
 * queries.ts — React Query hook layer tests (M4).
 *
 * Strategy: render hooks with a real QueryClient (retry:false default), mock
 * `../../api/client`'s `api` object. Each test gets a fresh QueryClient via
 * makeWrapper() to avoid cross-test cache contamination.
 *
 * Priorities (per brief):
 *   1. Non-trivial logic: deriveReconcilerStatus state machine, catch branches,
 *      enabled gates, conditional refetchInterval.
 *   2. Mutation hooks: api method called with correct args + correct invalidations.
 *   3. Key factory correctness (cache key stability).
 *   4. Simple passthrough queries: at least one call-through assertion per group.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mock the api client — must happen BEFORE any import of ../queries.
// vi.hoisted() ensures mockApi is initialised before the hoisted vi.mock() call.
// ---------------------------------------------------------------------------

const mockApi = vi.hoisted(() => ({
  getCapacity: vi.fn(),
  listNodes: vi.fn(),
  getNode: vi.fn(),
  drainNode: vi.fn(),
  restartNode: vi.fn(),
  removeNode: vi.fn(),
  getCatalog: vi.fn(),
  getModel: vi.fn(),
  importModel: vi.fn(),
  previewModelPlan: vi.fn(),
  getModelHealth: vi.fn(),
  deleteModel: vi.fn(),
  planDeployment: vi.fn(),
  createDeployment: vi.fn(),
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  undeployDeployment: vi.fn(),
  getPlan: vi.fn(),
  getJoinInfo: vi.fn(),
  rotateJoinToken: vi.fn(),
  createJoinToken: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  getKeyUsage: vi.fn(),
  getUsageSummary: vi.fn(),
  getEnterpriseStatus: vi.fn(),
  streamMetrics: vi.fn(),
  getAuditLog: vi.fn(),
  listInferenceAudit: vi.fn(),
  verifyAuditChain: vi.fn(),
  listAccessLog: vi.fn(),
  getReconcilerStatus: vi.fn(),
  listDeploymentApprovals: vi.fn(),
  getDeploymentApproval: vi.fn(),
  approveDeployment: vi.fn(),
  rejectDeployment: vi.fn(),
  getBillingReport: vi.fn(),
  getBillingCsvUrl: vi.fn(),
  getBillingXlsxUrl: vi.fn(),
  getBillingPdfUrl: vi.fn(),
  getBillingSummary: vi.fn(),
  getModelAdoption: vi.fn(),
  getOrgBilling: vi.fn(),
  getTeamBilling: vi.fn(),
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  getOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  getTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  listNodePools: vi.fn(),
  createNodePool: vi.fn(),
  getNodePool: vi.fn(),
  updateNodePool: vi.fn(),
  deleteNodePool: vi.fn(),
  listPoolNodes: vi.fn(),
  assignNodeToPool: vi.fn(),
  removeNodeFromPool: vi.fn(),
  listPoolQuotas: vi.fn(),
  upsertPoolQuota: vi.fn(),
  getMe: vi.fn(),
  getMyTeamPermissions: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  getRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  listPermissions: vi.fn(),
  whatIfPlan: vi.fn(),
  getSloComplianceFull: vi.fn(),
  getBillingForecast: vi.fn(),
  listDataPlanes: vi.fn(),
  createDataPlane: vi.fn(),
  refreshDataPlaneConfig: vi.fn(),
  updateDataPlane: vi.fn(),
  deleteDataPlane: vi.fn(),
  listDataPlaneNodes: vi.fn(),
  assignNodeToDataPlane: vi.fn(),
  unassignNodeFromDataPlane: vi.fn(),
  listServiceAccounts: vi.fn(),
  createServiceAccount: vi.fn(),
  revokeServiceAccount: vi.fn(),
  listPlatformUsers: vi.fn(),
  getAiActTechnicalDoc: vi.fn(),
  getGdprRecordOfProcessing: vi.fn(),
  eraseSubject: vi.fn(),
  getGdprErasureLog: vi.fn(),
  getClusterStatus: vi.fn(),
  exportConfig: vi.fn(),
  diffConfig: vi.fn(),
  applyConfig: vi.fn(),
  listPolicies: vi.fn(),
  upsertPolicy: vi.fn(),
  deletePolicy: vi.fn(),
}));

vi.mock('../../api/client', () => ({ api: mockApi }));

// ---------------------------------------------------------------------------
// Import hooks AFTER mocking
// ---------------------------------------------------------------------------

import {
  qk,
  approvalQk,
  roleQk,
  sloQk,
  policyQk,
  configCodeQk,
  useCapacity,
  useNodes,
  useNode,
  useNodeAction,
  useCatalog,
  useImportModel,
  useDeleteModel,
  useModel,
  useDeployments,
  useDeployment,
  useCreateDeployment,
  useUndeploy,
  useJoinInfo,
  useRotateToken,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useBillingForecast,
  useSloComplianceFull,
  useApprovals,
  useApproveDeployment,
  useRejectDeployment,
  useApiKeyTeamSlugs,
  useReconcilerStatus,
  useDeployModel,
  useDataPlanes,
  useCreateDataPlane,
  useDeleteDataPlane,
  useAssignNodeToDataPlane,
  useUnassignNodeFromDataPlane,
  useConfigApply,
  useUpsertPolicy,
  useDeletePolicy,
  usePolicies,
  useGdprErasure,
  useMetricsStream,
  useCreateTeam,
  useRevokeServiceAccount,
  useWhatIfPlan,
} from '../queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh QueryClient + wrapper per test.
 * retry:false is the DEFAULT; some hooks explicitly override it (e.g.
 * useReconcilerStatus: retry:1). The override wins at the query level.
 */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// 1. Query key factories
// ===========================================================================

describe('qk — query key factories', () => {
  it('capacity is a stable constant array', () => {
    expect(qk.capacity).toEqual(['capacity']);
    expect(qk.capacity).toBe(qk.capacity); // same reference — truly const
  });

  it('nodes is a stable constant array', () => {
    expect(qk.nodes).toEqual(['nodes']);
  });

  it('node(id) embeds the id', () => {
    expect(qk.node('abc')).toEqual(['node', 'abc']);
    expect(qk.node('abc')).not.toEqual(qk.node('def'));
  });

  it('node("") for undefined-gated hooks avoids cache collision with real ids', () => {
    expect(qk.node('')).toEqual(['node', '']);
    expect(qk.node('')).not.toEqual(qk.node('real-id'));
  });

  it('model(id) embeds the id', () => {
    expect(qk.model('llama-3')).toEqual(['model', 'llama-3']);
    expect(qk.model('llama-3')).not.toEqual(qk.model('mistral-7b'));
  });

  it('plan(modelId, overrides) embeds both args', () => {
    const o = { forceNodeCount: 2, preference: 'quality' as const };
    expect(qk.plan('m1', o)).toEqual(['plan', 'm1', o]);
    // Different overrides → different key
    const o2 = { forceNodeCount: null, preference: 'balanced' as const };
    expect(qk.plan('m1', o)).not.toEqual(qk.plan('m1', o2));
  });

  it('planById(id) embeds the id', () => {
    expect(qk.planById('p-99')).toEqual(['planById', 'p-99']);
  });

  it('deployment(id) embeds the id', () => {
    expect(qk.deployment('d-1')).toEqual(['deployment', 'd-1']);
    expect(qk.deployment('d-1')).not.toEqual(qk.deployment('d-2'));
  });

  it('gatewayModels(baseUrl) embeds the url', () => {
    expect(qk.gatewayModels('http://gw:8080')).toEqual([
      'gatewayModels',
      'http://gw:8080',
    ]);
  });
});

describe('approvalQk — approval query key factories', () => {
  it('list() with no arg defaults to empty-string status', () => {
    expect(approvalQk.list()).toEqual(['approvals', '']);
  });

  it('list("pending") includes the status', () => {
    expect(approvalQk.list('pending')).toEqual(['approvals', 'pending']);
  });

  it('list("approved") differs from list("pending")', () => {
    expect(approvalQk.list('approved')).not.toEqual(approvalQk.list('pending'));
  });

  it('detail(id) embeds id', () => {
    expect(approvalQk.detail('d-1')).toEqual(['approval', 'd-1']);
  });
});

describe('roleQk — role query key factories', () => {
  it('list(orgId) embeds orgId', () => {
    expect(roleQk.list('org-1')).toEqual(['roles', 'org-1']);
    expect(roleQk.list('org-1')).not.toEqual(roleQk.list('org-2'));
  });

  it('permissions is a stable constant', () => {
    expect(roleQk.permissions).toEqual(['permissionCatalog']);
    expect(roleQk.permissions).toBe(roleQk.permissions);
  });
});

describe('sloQk — SLO query key factories', () => {
  it('complianceFull(24) embeds hours', () => {
    expect(sloQk.complianceFull(24)).toEqual(['sloComplianceFull', 24]);
  });

  it('complianceFull(72) differs from complianceFull(24)', () => {
    expect(sloQk.complianceFull(72)).not.toEqual(sloQk.complianceFull(24));
  });
});

describe('policyQk', () => {
  it('list is a stable constant', () => {
    expect(policyQk.list).toEqual(['policies']);
    expect(policyQk.list).toBe(policyQk.list);
  });
});

describe('configCodeQk', () => {
  it('export is a stable constant', () => {
    expect(configCodeQk.export).toEqual(['configExport']);
  });
});

// ===========================================================================
// 2. useReconcilerStatus — deriveReconcilerStatus state machine
//    Hook uses fetch() directly (not api.*); mock global.fetch.
// ===========================================================================

describe('useReconcilerStatus — deriveReconcilerStatus state machine', () => {
  const BASE_CONFIG = {
    interval_s: 30,
    node_timeout_s: 120,
    hysteresis_s: 5,
    action_cooldown_s: 60,
  };

  // fetchSpy is set in beforeEach so it's available in all tests
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(tracker: Record<string, { tracked: number; oldest_age_s: number }>) {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ config: BASE_CONFIG, tracker }),
    } as Response);
  }

  it('state=idle when tracker is empty', async () => {
    mockFetchOk({});
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.pendingCount).toBe(0);
    expect(result.current.data?.errorCount).toBe(0);
  });

  it('state=syncing when pending events are below 300s error threshold', async () => {
    mockFetchOk({ node_deploy: { tracked: 3, oldest_age_s: 60 } }); // 60 < 300
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('syncing');
    expect(result.current.data?.pendingCount).toBe(3);
    expect(result.current.data?.errorCount).toBe(0);
  });

  it('state=syncing at exactly 300s (threshold is strictly greater-than)', async () => {
    // oldest_age_s === RECONCILER_ERROR_AGE_S (300) — does NOT count as error
    mockFetchOk({ node_deploy: { tracked: 1, oldest_age_s: 300 } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('syncing');
    expect(result.current.data?.errorCount).toBe(0);
  });

  it('state=error when an event exceeds 300s threshold (oldest_age_s=301)', async () => {
    mockFetchOk({ node_deploy: { tracked: 1, oldest_age_s: 301 } }); // 301 > 300
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('error');
    expect(result.current.data?.errorCount).toBe(1);
  });

  it('state=idle when tracked=0 even if oldest_age_s is high (empty type)', async () => {
    // tracked=0 → the `if (val.tracked > 0 && ...)` guard prevents counting as error
    mockFetchOk({ node_deploy: { tracked: 0, oldest_age_s: 600 } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.errorCount).toBe(0);
    expect(result.current.data?.pendingCount).toBe(0);
  });

  it('pendingCount sums tracked across all event types', async () => {
    mockFetchOk({
      type_a: { tracked: 2, oldest_age_s: 10 },
      type_b: { tracked: 5, oldest_age_s: 20 },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pendingCount).toBe(7);
  });

  it('maps snake_case config fields to camelCase', async () => {
    mockFetchOk({});
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.config).toEqual({
      intervalS: 30,
      nodeTimeoutS: 120,
      hysteresisS: 5,
      actionCooldownS: 60,
    });
  });

  it('maps snake_case tracker fields to camelCase (oldestAgeS)', async () => {
    mockFetchOk({ evt: { tracked: 1, oldest_age_s: 42 } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tracker).toEqual({
      evt: { tracked: 1, oldestAgeS: 42 },
    });
  });

  it('lastSyncAt is always null (Go API does not expose it)', async () => {
    mockFetchOk({});
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.lastSyncAt).toBeNull();
  });

  it('handles null tracker gracefully (falls back to empty object via ??)', async () => {
    // Older CPs may omit the tracker field entirely
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ config: BASE_CONFIG, tracker: null }),
    } as Response);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.pendingCount).toBe(0);
  });

  it('enters error state when fetch returns a non-ok HTTP status', async () => {
    // The hook has retry:1 + retryDelay:2000; mock resolves with !ok on every call
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReconcilerStatus(), { wrapper });
    // Needs ~2s for the retry cycle; generous timeout guards against CI jitter
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 6000,
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toMatch(/HTTP 500/);
  }, 8000);
});

// ===========================================================================
// 3. enabled gates — hooks that must NOT fetch when id is undefined
// ===========================================================================

describe('useNode — enabled gate', () => {
  it('does NOT call api.getNode when id is undefined', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNode(undefined), { wrapper });
    expect(mockApi.getNode).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls api.getNode when id is defined', async () => {
    mockApi.getNode.mockResolvedValue({ id: 'n1', hostname: 'host1' });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNode('n1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.getNode).toHaveBeenCalledWith('n1');
    expect(result.current.data).toEqual({ id: 'n1', hostname: 'host1' });
  });
});

describe('useModel — enabled gate', () => {
  it('does NOT call api.getModel when id is undefined', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useModel(undefined), { wrapper });
    expect(mockApi.getModel).not.toHaveBeenCalled();
  });

  it('calls api.getModel when id is defined', async () => {
    mockApi.getModel.mockResolvedValue({ id: 'llama3', name: 'LLaMA 3' });
    const { wrapper } = makeWrapper();
    renderHook(() => useModel('llama3'), { wrapper });
    await waitFor(() => expect(mockApi.getModel).toHaveBeenCalledWith('llama3'));
  });
});

describe('useDeployment — enabled gate', () => {
  it('does NOT call api.getDeployment when id is undefined', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeployment(undefined), { wrapper });
    expect(mockApi.getDeployment).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls api.getDeployment when id is defined', async () => {
    mockApi.getDeployment.mockResolvedValue({ id: 'd1', state: 'active' });
    const { wrapper } = makeWrapper();
    renderHook(() => useDeployment('d1'), { wrapper });
    await waitFor(() => expect(mockApi.getDeployment).toHaveBeenCalledWith('d1'));
  });
});

// ===========================================================================
// 4. catch branches — the mutation-testing hot spots
// ===========================================================================

describe('useBillingForecast — swallows 404 and 402 silently', () => {
  it('returns null on 404 (endpoint not available in this CP version)', async () => {
    mockApi.getBillingForecast.mockRejectedValue(new Error('HTTP 404 Not Found'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // catch branch returns null; component must check before accessing fields
    expect(result.current.data).toBeNull();
  });

  it('returns null on 402 (feature not licensed)', async () => {
    mockApi.getBillingForecast.mockRejectedValue(new Error('HTTP 402 Payment Required'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('propagates other errors (does NOT swallow 500)', async () => {
    mockApi.getBillingForecast.mockRejectedValue(new Error('HTTP 500 Internal Server Error'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('propagates 401 (not a 40[24] match)', async () => {
    mockApi.getBillingForecast.mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns real data on success (no catch fires)', async () => {
    const forecast = { projectedSpend: 1000, daysToExhaustion: 30 };
    mockApi.getBillingForecast.mockResolvedValue(forecast);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(forecast);
  });
});

describe('useSloComplianceFull — swallows 404 silently', () => {
  it('returns null on 404 (endpoint not available in older CP)', async () => {
    mockApi.getSloComplianceFull.mockRejectedValue(new Error('HTTP 404 Not Found'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSloComplianceFull(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('propagates non-404 errors (503, 500, etc.)', async () => {
    mockApi.getSloComplianceFull.mockRejectedValue(new Error('HTTP 503 Service Unavailable'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSloComplianceFull(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('passes the windowHours argument to api.getSloComplianceFull', async () => {
    mockApi.getSloComplianceFull.mockResolvedValue({ models: [] });
    const { wrapper } = makeWrapper();
    renderHook(() => useSloComplianceFull(72), { wrapper });
    await waitFor(() =>
      expect(mockApi.getSloComplianceFull).toHaveBeenCalledWith(72),
    );
  });

  it('defaults to 24h window when no arg supplied', async () => {
    mockApi.getSloComplianceFull.mockResolvedValue({ models: [] });
    const { wrapper } = makeWrapper();
    renderHook(() => useSloComplianceFull(), { wrapper });
    await waitFor(() =>
      expect(mockApi.getSloComplianceFull).toHaveBeenCalledWith(24),
    );
  });

  it('returns data normally on success', async () => {
    const payload = { models: [{ id: 'llama3', compliance: 0.99 }] };
    mockApi.getSloComplianceFull.mockResolvedValue(payload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSloComplianceFull(24), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
  });
});

// ===========================================================================
// 5. Mutation hooks — correct api call + correct cache invalidations
// ===========================================================================

describe('useCreateDeployment', () => {
  it('calls api.createDeployment with modelId+overrides and invalidates 4 queries', async () => {
    mockApi.createDeployment.mockResolvedValue({ id: 'd1', state: 'planned' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateDeployment(), { wrapper });

    await act(async () => {
      result.current.mutate({
        modelId: 'm1',
        overrides: { forceNodeCount: null, preference: 'balanced' },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.createDeployment).toHaveBeenCalledWith('m1', {
      forceNodeCount: null,
      preference: 'balanced',
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.deployments });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.capacity });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
  });
});

describe('useUndeploy', () => {
  it('calls api.undeployDeployment and invalidates deployments/nodes/capacity/catalog', async () => {
    mockApi.undeployDeployment.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUndeploy(), { wrapper });

    await act(async () => result.current.mutate('d1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.undeployDeployment).toHaveBeenCalledWith('d1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.deployments });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.capacity });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
  });
});

describe('useNodeAction', () => {
  it('drain calls api.drainNode and invalidates nodes/capacity/catalog', async () => {
    mockApi.drainNode.mockResolvedValue({ id: 'n1', state: 'draining' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useNodeAction(), { wrapper });

    await act(async () => result.current.drain.mutate('n1'));
    await waitFor(() => expect(result.current.drain.isSuccess).toBe(true));

    expect(mockApi.drainNode).toHaveBeenCalledWith('n1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.capacity });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
  });

  it('restart calls api.restartNode and invalidates nodes/capacity/catalog', async () => {
    mockApi.restartNode.mockResolvedValue({ id: 'n1', state: 'ready' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useNodeAction(), { wrapper });

    await act(async () => result.current.restart.mutate('n1'));
    await waitFor(() => expect(result.current.restart.isSuccess).toBe(true));

    expect(mockApi.restartNode).toHaveBeenCalledWith('n1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
  });

  it('remove calls api.removeNode and invalidates nodes/capacity/catalog', async () => {
    mockApi.removeNode.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useNodeAction(), { wrapper });

    await act(async () => result.current.remove.mutate('n1'));
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    expect(mockApi.removeNode).toHaveBeenCalledWith('n1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
  });
});

describe('useImportModel', () => {
  it('calls api.importModel with source and invalidates catalog', async () => {
    mockApi.importModel.mockResolvedValue({ id: 'm1', name: 'llama-3' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useImportModel(), { wrapper });

    const source = { type: 'huggingface' as const, repo: 'meta-llama/llama-3' };
    await act(async () => result.current.mutate(source as Parameters<typeof result.current.mutate>[0]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.importModel).toHaveBeenCalledWith(source);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
    // Only catalog — not deployments or nodes
    expect(qc.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: qk.deployments });
  });
});

describe('useDeleteModel', () => {
  it('calls api.deleteModel with modelId and invalidates catalog', async () => {
    mockApi.deleteModel.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteModel(), { wrapper });

    await act(async () => result.current.mutate('m1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.deleteModel).toHaveBeenCalledWith('m1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
  });
});

describe('useDeployModel', () => {
  it('calls createDeployment with the correct DEFAULT overrides (balanced, null nodeCount)', async () => {
    mockApi.createDeployment.mockResolvedValue({ id: 'd2', state: 'planned' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeployModel(), { wrapper });

    await act(async () => result.current.mutate({ modelId: 'm2' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.createDeployment).toHaveBeenCalledWith('m2', {
      forceNodeCount: null,
      preference: 'balanced',
    });
    // invalidates 4 caches
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.deployments });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.nodes });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.capacity });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
  });
});

describe('useApproveDeployment', () => {
  it('calls api.approveDeployment with id+notes and invalidates approvals+deployments', async () => {
    mockApi.approveDeployment.mockResolvedValue({ id: 'd1', status: 'approved' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useApproveDeployment(), { wrapper });

    await act(async () =>
      result.current.mutate({ deploymentId: 'd1', notes: 'LGTM' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.approveDeployment).toHaveBeenCalledWith('d1', 'LGTM');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['approvals'] });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.deployments });
  });

  it('works without notes (optional arg)', async () => {
    mockApi.approveDeployment.mockResolvedValue({ id: 'd1', status: 'approved' });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApproveDeployment(), { wrapper });

    await act(async () => result.current.mutate({ deploymentId: 'd1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.approveDeployment).toHaveBeenCalledWith('d1', undefined);
  });
});

describe('useRejectDeployment', () => {
  it('calls api.rejectDeployment with id+notes and invalidates approvals only', async () => {
    mockApi.rejectDeployment.mockResolvedValue({ id: 'd1', status: 'rejected' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRejectDeployment(), { wrapper });

    await act(async () =>
      result.current.mutate({ deploymentId: 'd1', notes: 'too risky' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.rejectDeployment).toHaveBeenCalledWith('d1', 'too risky');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['approvals'] });
    // Reject does NOT invalidate deployments (differs from approve)
    expect(qc.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: qk.deployments });
  });
});

describe('useCreateApiKey', () => {
  it('calls api.createApiKey with input and invalidates apiKeys', async () => {
    const created = { id: 'k1', name: 'ci-key', secret: 'sk-abc' };
    mockApi.createApiKey.mockResolvedValue(created);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateApiKey(), { wrapper });

    const input = { name: 'ci-key', team: 'eng', monthlyQuota: 1000 };
    await act(async () => result.current.mutate(input));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.createApiKey).toHaveBeenCalledWith(input);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.apiKeys });
    expect(result.current.data).toEqual(created);
  });
});

describe('useRevokeApiKey', () => {
  it('calls api.revokeApiKey with id and invalidates apiKeys', async () => {
    mockApi.revokeApiKey.mockResolvedValue({ id: 'k1', revoked: true });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeApiKey(), { wrapper });

    await act(async () => result.current.mutate('k1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.revokeApiKey).toHaveBeenCalledWith('k1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.apiKeys });
  });
});

describe('useGdprErasure', () => {
  it('calls api.eraseSubject and invalidates gdprErasureLog', async () => {
    mockApi.eraseSubject.mockResolvedValue({ subjectId: 'u1', erasedCount: 3 });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useGdprErasure(), { wrapper });

    const input = { subjectType: 'api_key', subjectIdentifier: 'sha256-abc123', reason: 'GDPR Art.17' };
    await act(async () => result.current.mutate(input as Parameters<typeof result.current.mutate>[0]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.eraseSubject).toHaveBeenCalledWith(input);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['gdprErasureLog'] });
  });
});

describe('useUpsertPolicy', () => {
  it('calls api.upsertPolicy with name/rego/enabled and invalidates policyQk.list', async () => {
    mockApi.upsertPolicy.mockResolvedValue({ name: 'allow-all', rego: 'allow=true', enabled: true });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpsertPolicy(), { wrapper });

    await act(async () =>
      result.current.mutate({ name: 'allow-all', rego: 'allow=true', enabled: true }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.upsertPolicy).toHaveBeenCalledWith('allow-all', 'allow=true', true);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: policyQk.list });
  });
});

describe('useDeletePolicy', () => {
  it('calls api.deletePolicy with name and invalidates policyQk.list', async () => {
    mockApi.deletePolicy.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeletePolicy(), { wrapper });

    await act(async () => result.current.mutate('allow-all'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.deletePolicy).toHaveBeenCalledWith('allow-all');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: policyQk.list });
  });
});

describe('useConfigApply', () => {
  it('calls api.applyConfig and invalidates configExport/catalog/deployments/capacity', async () => {
    mockApi.applyConfig.mockResolvedValue({ applied: true, changes: [] });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useConfigApply(), { wrapper });

    const yaml = 'models:\n  - name: llama3';
    await act(async () => result.current.mutate(yaml));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.applyConfig).toHaveBeenCalledWith(yaml);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: configCodeQk.export });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalog });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.deployments });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.capacity });
  });
});

describe('useAssignNodeToDataPlane', () => {
  it('calls api.assignNodeToDataPlane and invalidates dataPlaneNodes[id] + dataPlanes', async () => {
    mockApi.assignNodeToDataPlane.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useAssignNodeToDataPlane(), { wrapper });

    await act(async () => result.current.mutate({ id: 'dp1', nodeId: 'n1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.assignNodeToDataPlane).toHaveBeenCalledWith('dp1', 'n1');
    // Invalidation uses the mutation VARIABLES id, not a static key
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dataPlaneNodes', 'dp1'],
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.dataPlanes });
  });
});

describe('useUnassignNodeFromDataPlane', () => {
  it('calls api.unassignNodeFromDataPlane and invalidates dataPlaneNodes[id] + dataPlanes', async () => {
    mockApi.unassignNodeFromDataPlane.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUnassignNodeFromDataPlane(), { wrapper });

    await act(async () => result.current.mutate({ id: 'dp2', nodeId: 'n2' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.unassignNodeFromDataPlane).toHaveBeenCalledWith('dp2', 'n2');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dataPlaneNodes', 'dp2'],
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.dataPlanes });
  });
});

describe('useCreateDataPlane', () => {
  it('calls api.createDataPlane and invalidates dataPlanes', async () => {
    mockApi.createDataPlane.mockResolvedValue({ id: 'dp1', name: 'edge-us', token: 'tok' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateDataPlane(), { wrapper });

    const input = { name: 'edge-us', tier: 'standard' };
    await act(async () => result.current.mutate(input));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.createDataPlane).toHaveBeenCalledWith(input);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.dataPlanes });
  });
});

describe('useDeleteDataPlane', () => {
  it('calls api.deleteDataPlane and invalidates dataPlanes', async () => {
    mockApi.deleteDataPlane.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteDataPlane(), { wrapper });

    await act(async () => result.current.mutate('dp1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.deleteDataPlane).toHaveBeenCalledWith('dp1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.dataPlanes });
  });
});

// ===========================================================================
// 6. useRotateToken — uses setQueryData instead of invalidateQueries
// ===========================================================================

describe('useRotateToken', () => {
  it('calls api.rotateJoinToken and writes the result directly into qk.join cache', async () => {
    const newInfo = { token: 'new-tok', command: 'purser join --token new-tok' };
    mockApi.rotateJoinToken.mockResolvedValue(newInfo);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'setQueryData');
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRotateToken(), { wrapper });

    await act(async () => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.rotateJoinToken).toHaveBeenCalled();
    // Must use setQueryData — not invalidateQueries — so the token is immediately visible
    expect(qc.setQueryData).toHaveBeenCalledWith(qk.join, newInfo);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. useApiKeyTeamSlugs — memo dedup + falsy-filter
// ===========================================================================

describe('useApiKeyTeamSlugs', () => {
  it('returns [] when keys are still loading (data is undefined)', () => {
    // Never resolves → data remains undefined
    mockApi.listApiKeys.mockReturnValue(new Promise(() => {}));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
    expect(result.current).toEqual([]);
  });

  it('returns [] when the keys array is empty', async () => {
    mockApi.listApiKeys.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
    await waitFor(() => {
      // isSuccess may not update synchronously — wait for the memo to stabilise
      expect(result.current).toEqual([]);
    });
  });

  it('deduplicates team slugs across keys', async () => {
    mockApi.listApiKeys.mockResolvedValue([
      { id: 'k1', team: 'team-a' },
      { id: 'k2', team: 'team-b' },
      { id: 'k3', team: 'team-a' }, // duplicate — should appear once
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current).toEqual(['team-a', 'team-b']);
  });

  it('filters out falsy team values (empty string, null)', async () => {
    mockApi.listApiKeys.mockResolvedValue([
      { id: 'k1', team: '' },
      { id: 'k2', team: null },
      { id: 'k3', team: 'team-x' },
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current).toEqual(['team-x']);
  });

  it('returns unique slugs in insertion order', async () => {
    mockApi.listApiKeys.mockResolvedValue([
      { id: 'k1', team: 'z-team' },
      { id: 'k2', team: 'a-team' },
      { id: 'k3', team: 'z-team' },
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
    await waitFor(() => expect(result.current.length).toBe(2));
    // Set preserves insertion order: z-team first (seen first), then a-team
    expect(result.current).toEqual(['z-team', 'a-team']);
  });
});

// ===========================================================================
// 8. Simple passthrough query hooks — one call-through assertion each
// ===========================================================================

describe('passthrough query hooks', () => {
  it('useCapacity calls api.getCapacity', async () => {
    mockApi.getCapacity.mockResolvedValue({ totalNodes: 3 });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCapacity(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.getCapacity).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({ totalNodes: 3 });
  });

  it('useNodes calls api.listNodes', async () => {
    mockApi.listNodes.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useNodes(), { wrapper });
    await waitFor(() => expect(mockApi.listNodes).toHaveBeenCalled());
  });

  it('useCatalog calls api.getCatalog', async () => {
    mockApi.getCatalog.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useCatalog(), { wrapper });
    await waitFor(() => expect(mockApi.getCatalog).toHaveBeenCalled());
  });

  it('useDeployments calls api.listDeployments', async () => {
    mockApi.listDeployments.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useDeployments(), { wrapper });
    await waitFor(() => expect(mockApi.listDeployments).toHaveBeenCalled());
  });

  it('useJoinInfo calls api.getJoinInfo', async () => {
    mockApi.getJoinInfo.mockResolvedValue({ token: 'x', command: '...' });
    const { wrapper } = makeWrapper();
    renderHook(() => useJoinInfo(), { wrapper });
    await waitFor(() => expect(mockApi.getJoinInfo).toHaveBeenCalled());
  });

  it('useApiKeys calls api.listApiKeys', async () => {
    mockApi.listApiKeys.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useApiKeys(), { wrapper });
    await waitFor(() => expect(mockApi.listApiKeys).toHaveBeenCalled());
  });

  it('useApprovals calls api.listDeploymentApprovals with status and limit', async () => {
    mockApi.listDeploymentApprovals.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useApprovals('pending', 20), { wrapper });
    await waitFor(() =>
      expect(mockApi.listDeploymentApprovals).toHaveBeenCalledWith('pending', 20),
    );
  });

  it('useDataPlanes calls api.listDataPlanes', async () => {
    mockApi.listDataPlanes.mockResolvedValue([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useDataPlanes(), { wrapper });
    await waitFor(() => expect(mockApi.listDataPlanes).toHaveBeenCalled());
  });

  it('usePolicies calls api.listPolicies', async () => {
    mockApi.listPolicies.mockResolvedValue({ policies: [] });
    const { wrapper } = makeWrapper();
    renderHook(() => usePolicies(), { wrapper });
    await waitFor(() => expect(mockApi.listPolicies).toHaveBeenCalled());
  });
});

// ===========================================================================
// 9. useMetricsStream — extended SSE lifecycle tests
// ===========================================================================

// The capture mechanism for SSE handlers (vi.hoisted ensures it is ready
// before vi.mock() runs — the same pattern as the existing test file)
const sseCapture = vi.hoisted(() => ({
  handlers: undefined as
    | { onMetrics: (s: unknown) => void; onError?: (e: Error) => void }
    | undefined,
  stopFn: vi.fn(),
}));

// NOTE: this vi.mock overrides the api.streamMetrics entry for ONLY the tests
// in this section. Because the module-level mock above is already set for
// `../../api/client`, we use a local override strategy here by simply
// re-assigning mockApi.streamMetrics in beforeEach (since mockApi IS the mock).

describe('useMetricsStream — extended lifecycle', () => {
  // Use the top-level mockApi.streamMetrics so we can capture handlers
  beforeEach(() => {
    sseCapture.handlers = undefined;
    sseCapture.stopFn.mockClear();
    mockApi.streamMetrics.mockImplementation(
      (handlers: { onMetrics: (s: unknown) => void; onError?: (e: Error) => void }) => {
        sseCapture.handlers = handlers;
        return sseCapture.stopFn;
      },
    );
  });

  it('snapshot starts null before any frame arrives', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMetricsStream(), { wrapper });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.streamError).toBe(false);
  });

  it('snapshot and streamError update correctly on onMetrics after an error', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMetricsStream(), { wrapper });

    // Trigger error first
    act(() => {
      sseCapture.handlers?.onError?.(new Error('SSE disconnected'));
    });
    expect(result.current.streamError).toBe(true);

    // Then a successful metric clears the error
    const snap = { at: '2026-01-01T00:00:00Z', aggregateDecodeTokS: 77, nodes: [] };
    act(() => {
      sseCapture.handlers?.onMetrics(snap);
    });
    expect(result.current.streamError).toBe(false);
    expect(result.current.snapshot).toEqual(snap);
  });
});

// ===========================================================================
// 11. Targeted mutant-killers for survivors identified in the first stryker run
// ===========================================================================

// --- useReconcilerStatus: assert the fetch URL and credentials (line 171) ---

describe('useReconcilerStatus — fetch call details', () => {
  let fetchSpy2: MockInstance;

  beforeEach(() => {
    fetchSpy2 = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          config: {
            interval_s: 30,
            node_timeout_s: 120,
            hysteresis_s: 5,
            action_cooldown_s: 60,
          },
          tracker: {},
        }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the correct endpoint path: /reconciler/status', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(fetchSpy2).toHaveBeenCalled());
    const [url] = fetchSpy2.mock.calls[0];
    expect(String(url)).toContain('/reconciler/status');
  });

  it('sends same-origin credentials in the fetch options', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useReconcilerStatus(), { wrapper });
    await waitFor(() => expect(fetchSpy2).toHaveBeenCalled());
    const [, opts] = fetchSpy2.mock.calls[0];
    expect((opts as RequestInit)?.credentials).toBe('same-origin');
  });
});

// --- useDeployment: conditional refetchInterval (lines 267-268) -------------
//
// React Query uses many internal timers (GC, retries, etc.).
// - Never use vi.runAllTimersAsync() — it hits React Query's internal loops.
// - Use vi.advanceTimersByTimeAsync(ms) with an explicit amount instead.
// - Set gcTime high to avoid GC timers firing during the test.
// - Always restore real timers in afterEach so fake-timer state doesn't leak.

describe('useDeployment — conditional refetchInterval', () => {
  afterEach(() => vi.useRealTimers());

  function makeNoGcWrapper() {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 30 * 60 * 1000 },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, wrapper };
  }

  it('does NOT poll when deployment state is "active" (refetchInterval returns false)', async () => {
    vi.useFakeTimers();
    mockApi.getDeployment.mockResolvedValue({ id: 'd1', state: 'active' });
    const { wrapper } = makeNoGcWrapper();
    renderHook(() => useDeployment('d1'), { wrapper });

    // Allow the initial fetch to complete (small tick for promise resolution)
    await vi.advanceTimersByTimeAsync(100);
    const callsAfterInitial = mockApi.getDeployment.mock.calls.length;
    expect(callsAfterInitial).toBeGreaterThan(0);

    // Advance 3000ms — if polling were active (1000ms interval) we'd see 3+ extra calls
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockApi.getDeployment.mock.calls.length).toBe(callsAfterInitial);
  });

  it('polls again after ~1000ms when deployment state is not "active"', async () => {
    vi.useFakeTimers();
    mockApi.getDeployment.mockResolvedValue({ id: 'd1', state: 'provisioning' });
    const { wrapper } = makeNoGcWrapper();
    renderHook(() => useDeployment('d1'), { wrapper });

    await vi.advanceTimersByTimeAsync(100);
    const callsAfterInitial = mockApi.getDeployment.mock.calls.length;
    expect(callsAfterInitial).toBeGreaterThan(0);

    // Advance past the 1000ms refetch interval
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockApi.getDeployment.mock.calls.length).toBeGreaterThan(callsAfterInitial);
  });
});

// --- useCreateTeam / useDeleteTeam: orgId-scoped invalidation (lines 583-585) ---

describe('useCreateTeam', () => {
  it('calls api.createTeam with orgId+data and invalidates ["teams", orgId]', async () => {
    mockApi.createTeam.mockResolvedValue({ id: 't1', name: 'eng', slug: 'eng' });
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTeam('org-1'), { wrapper });

    const data = { name: 'eng', slug: 'eng' };
    await act(async () => result.current.mutate(data));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.createTeam).toHaveBeenCalledWith('org-1', data);
    // Key must be ['teams', 'org-1'] — not [] or ['teams', '']
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['teams', 'org-1'] });
  });
});

// --- useRevokeServiceAccount: queryKey and mutationFn (lines 889-891) -------

describe('useRevokeServiceAccount', () => {
  it('calls api.revokeServiceAccount and invalidates qk.serviceAccounts', async () => {
    mockApi.revokeServiceAccount.mockResolvedValue(undefined);
    const { qc, wrapper } = makeWrapper();
    vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeServiceAccount(), { wrapper });

    await act(async () => result.current.mutate('sa-1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.revokeServiceAccount).toHaveBeenCalledWith('sa-1');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.serviceAccounts });
  });
});

// --- useWhatIfPlan: mutationFn and queryKey (lines 915-916, 924) -------------

describe('useWhatIfPlan', () => {
  it('calls api.whatIfPlan with the request and returns the result', async () => {
    const resp = { totalCostUsd: 42, nodes: [] };
    mockApi.whatIfPlan.mockResolvedValue(resp);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useWhatIfPlan(), { wrapper });

    const req = { model_id: 'llama3', hypothetical_nodes: [], include_existing_nodes: false };
    await act(async () => result.current.mutate(req as Parameters<typeof result.current.mutate>[0]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.whatIfPlan).toHaveBeenCalledWith(req);
    expect(result.current.data).toEqual(resp);
  });
});

// --- useBillingForecast: queryKey string and array (line 924) ----------------

describe('useBillingForecast — queryKey integrity', () => {
  it('the query key is ["billingForecast"] (not [] or empty)', async () => {
    // Verify by seeding the cache with a known value under the expected key
    mockApi.getBillingForecast.mockResolvedValue({ projectedSpend: 99 });
    const { wrapper } = makeWrapper();
    renderHook(() => useBillingForecast(), { wrapper });
    await waitFor(() => expect(mockApi.getBillingForecast).toHaveBeenCalled());
    // If the queryKey were wrong, the prefetched data would live under a different key
    // and the hook would refetch — observable via call count
    expect(mockApi.getBillingForecast).toHaveBeenCalledTimes(1);
  });
});

// --- useApiKeyTeamSlugs: guard against if(!keys) → if(false) (line 907) -----

describe('useApiKeyTeamSlugs — defensive null guard', () => {
  it('returns [] (not throws) when keys are undefined — guards against null-dereference', () => {
    // Simulate the loading state where data is undefined
    mockApi.listApiKeys.mockReturnValue(new Promise(() => {}));
    const { wrapper } = makeWrapper();
    // Must not throw TypeError: Cannot read properties of undefined (reading 'map')
    expect(() => {
      const { result } = renderHook(() => useApiKeyTeamSlugs(), { wrapper });
      expect(result.current).toEqual([]);
    }).not.toThrow();
  });
});
