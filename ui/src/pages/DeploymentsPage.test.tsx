// ---------------------------------------------------------------------------
// TDD tests for DeploymentsPage sub-components.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { DeploymentHealthBadge, DeploymentsPage } from './DeploymentsPage';

// Mock the queries module so we control what useModelHealth returns.
vi.mock('../hooks/queries', () => ({
  useModelHealth: vi.fn(),
  // Stub the rest so imports that resolve the module don't fail.
  useDeployments: vi.fn(() => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() })),
  useNodes: vi.fn(() => ({ data: [] })),
  useUndeploy: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// TS helper: typed access to the mocked functions.
import { useModelHealth, useDeployments } from '../hooks/queries';
import type { Deployment, DeploymentState } from '../api/types';
const mockedUseModelHealth = vi.mocked(useModelHealth);
const mockedUseDeployments = vi.mocked(useDeployments);

function renderDeploymentsPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <I18nProvider>
          <DeploymentsPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// A real-API-shaped deployment (after normalization by http.ts).
const realShapedDeployment: Deployment = {
  id: 'dep-0e1cc9e9715614e2e5a85f73',
  plan: {
    planId: 'plan-tinyllama-1b-node-10fb2f7a06f92660-56b41691',
    modelId: 'tinyllama-1b',
    quantization: 'q4_k_m',
    assignments: [
      { nodeId: 'node-10fb2f7a06f92660', role: 'host', layerStart: 0, layerEnd: 0, draft: false },
    ],
    pipelineOrder: ['node-10fb2f7a06f92660'],
    estimated: { decodeTokSMin: 0, decodeTokSMax: 0, prefillTokSMin: 0, prefillTokSMax: 0, headroomGb: 0 },
    cost: 0,
    explanation: [],
  },
  state: 'active',
  nodeStatus: [{ nodeId: 'node-10fb2f7a06f92660', state: 'running', progress: 1, detail: '' }],
  createdAt: '2026-09-11T19:21:38.48794049Z',
};

describe('DeploymentHealthBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders_healthy_badge_when_model_healthy', () => {
    mockedUseModelHealth.mockReturnValue({
      data: {
        modelId: 'llama-8b',
        status: 'healthy',
        deploymentId: 'dep-1',
        deploymentState: 'active',
        nodeCount: 2,
      },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);

    render(<DeploymentHealthBadge modelId="llama-8b" />);

    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders_degraded_badge_when_model_degraded', () => {
    mockedUseModelHealth.mockReturnValue({
      data: {
        modelId: 'llama-8b',
        status: 'degraded',
        deploymentId: 'dep-1',
        deploymentState: 'provisioning',
        nodeCount: 2,
      },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);

    render(<DeploymentHealthBadge modelId="llama-8b" />);

    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders_unavailable_when_no_deployment', () => {
    mockedUseModelHealth.mockReturnValue({
      data: {
        modelId: 'llama-8b',
        status: 'unavailable',
        deploymentId: '',
        deploymentState: '',
        nodeCount: 0,
        errorMessage: 'no deployment found for this model',
      },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);

    render(<DeploymentHealthBadge modelId="llama-8b" />);

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('renders_neutral_when_loading', () => {
    mockedUseModelHealth.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      isPending: true,
      isSuccess: false,
    } as ReturnType<typeof useModelHealth>);

    render(<DeploymentHealthBadge modelId="llama-8b" />);

    // Loading state shows a neutral placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DeploymentsPage — real-shaped deployment renders without crashing
// ---------------------------------------------------------------------------

describe('DeploymentsPage — real API shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelHealth.mockReturnValue({
      data: { modelId: 'tinyllama-1b', status: 'healthy', deploymentId: 'dep-0e1cc9e9715614e2e5a85f73', deploymentState: 'active', nodeCount: 1 },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);
  });

  it('renders deployment model id from real-shaped data', async () => {
    mockedUseDeployments.mockReturnValue({
      data: [realShapedDeployment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    await waitFor(() => expect(screen.getByText('tinyllama-1b')).toBeInTheDocument());
  });

  it('shows the active state badge', async () => {
    mockedUseDeployments.mockReturnValue({
      data: [realShapedDeployment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    // The badge label is "Active — the model is serving" (full i18n string)
    await waitFor(() =>
      expect(screen.getByText('Active — the model is serving')).toBeInTheDocument()
    );
  });
});

// ---------------------------------------------------------------------------
// DeploymentsPage — E4 fix: detail.error surfaced + no fabricated createdAt
// ---------------------------------------------------------------------------

describe('DeploymentsPage — E4: error surfacing and absent createdAt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelHealth.mockReturnValue({
      data: { modelId: 'tinyllama-1b', status: 'unavailable', deploymentId: '', deploymentState: 'stopped', nodeCount: 0 },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);
  });

  it('shows error message when deployment has a detail error', async () => {
    // This shape reflects what normalizeDeployment produces after camelizeKeys
    // when the API emits { detail: { error: "host node-xyz not ready", ... } }.
    const depWithError: Deployment = {
      ...realShapedDeployment,
      state: 'stopped',
      error: 'host node-10fb2f7a06f92660 not ready',
      plan: {
        ...realShapedDeployment.plan,
        assignments: [], // engines: null → 0 assignments
      },
      nodeStatus: [],
    };
    mockedUseDeployments.mockReturnValue({
      data: [depWithError],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    // The error should be rendered in the card
    await waitFor(() =>
      expect(screen.getByTestId('dep-error')).toBeInTheDocument()
    );
    expect(screen.getByTestId('dep-error')).toHaveTextContent(
      'Error: host node-10fb2f7a06f92660 not ready'
    );
  });

  it('shows 0 nodes alongside the error when engines was null', async () => {
    const depWithError: Deployment = {
      ...realShapedDeployment,
      state: 'stopped',
      error: 'host node-10fb2f7a06f92660 not ready',
      plan: {
        ...realShapedDeployment.plan,
        assignments: [],
      },
      nodeStatus: [],
    };
    mockedUseDeployments.mockReturnValue({
      data: [depWithError],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    await waitFor(() =>
      expect(screen.getByTestId('dep-error')).toBeInTheDocument()
    );
    // "0 nodes" appears in the subtitle line
    expect(screen.getByText(/0\s+nodes/i)).toBeInTheDocument();
  });

  it('shows dash for absent createdAt, not today\'s date', async () => {
    const depNoDate: Deployment = {
      ...realShapedDeployment,
      state: 'stopped',
      createdAt: '', // absent on wire → normalizer produces ''
    };
    mockedUseDeployments.mockReturnValue({
      data: [depNoDate],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    await waitFor(() =>
      expect(screen.getByTestId('dep-created-at')).toBeInTheDocument()
    );
    // Should show "—" not a fabricated today's date
    expect(screen.getByTestId('dep-created-at')).toHaveTextContent('—');
    // Verify today's date is NOT shown as createdAt
    const todaySlice = new Date().toISOString().slice(0, 10);
    expect(screen.getByTestId('dep-created-at')).not.toHaveTextContent(todaySlice);
  });

  it('does not show error element when deployment has no error', async () => {
    mockedUseDeployments.mockReturnValue({
      data: [realShapedDeployment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    await waitFor(() => expect(screen.getByText('tinyllama-1b')).toBeInTheDocument());
    expect(screen.queryByTestId('dep-error')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DeploymentsPage — state label mapping (the core bug fix)
// Failing-first proof: before the fix, 'stopped' renders "Rolling out …"
// After the fix, each state must render its own label.
// ---------------------------------------------------------------------------

function makeDeployment(state: DeploymentState): Deployment {
  return {
    ...realShapedDeployment,
    state,
  };
}

describe('DeploymentsPage — state label per deployment state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelHealth.mockReturnValue({
      data: { modelId: 'tinyllama-1b', status: 'healthy', deploymentId: 'dep-1', deploymentState: 'active', nodeCount: 1 },
      isLoading: false,
      isError: false,
      error: null,
      isPending: false,
      isSuccess: true,
    } as ReturnType<typeof useModelHealth>);
  });

  // Failing-first: STOPPED must NOT show the provisioning label.
  it('stopped_deployment_shows_stopped_label_not_rolling_out', async () => {
    mockedUseDeployments.mockReturnValue({
      data: [makeDeployment('stopped')],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);

    renderDeploymentsPage();

    await waitFor(() =>
      expect(screen.getByText('Stopped — no longer serving')).toBeInTheDocument()
    );
    expect(screen.queryByText('Rolling out — nodes are loading')).not.toBeInTheDocument();
  });

  // Parametrized: every state must render its own dedicated label.
  const STATE_EXPECTED: [DeploymentState, string][] = [
    ['planned',      'Planned — not yet rolling out'],
    ['provisioning', 'Rolling out — nodes are loading'],
    ['active',       'Active — the model is serving'],
    ['rebalancing',  'Rebalancing — redistributing layers'],
    ['stopping',     'Stopping — tearing down'],
    ['stopped',      'Stopped — no longer serving'],
    ['failed',       'Failed — rollout did not complete'],
  ];

  it.each(STATE_EXPECTED)(
    'state_%s_renders_label_%s',
    async (state, expectedLabel) => {
      mockedUseDeployments.mockReturnValue({
        data: [makeDeployment(state)],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDeployments>);

      renderDeploymentsPage();

      await waitFor(() =>
        expect(screen.getByText(expectedLabel)).toBeInTheDocument()
      );
    }
  );
});
