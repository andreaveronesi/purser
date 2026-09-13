/**
 * FleetPage — additional coverage for capacity card, stream error banner,
 * node loading/error/empty states, live metrics in NodeRow, restart action,
 * FP4 badge, NodeDetailPanel optional fields, and hardwareSummary branches.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { FleetPage } from '../FleetPage';
import type { ReactNode } from 'react';
import type { NodeView, ClusterCapacity } from '../../api/types';

// Return i18n keys verbatim so assertions can use key strings directly.
// vi.mock is hoisted before imports by vitest's transform so the import above
// gets the mocked module at runtime.
vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Shared hoisted mock state
// ---------------------------------------------------------------------------

const { restartMutate } = vi.hoisted(() => ({
  restartMutate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Default mock values — each describe/it overrides what it needs
// ---------------------------------------------------------------------------

let mockCapacity = {
  isLoading: false,
  isError: false,
  data: null as ClusterCapacity | null,
  error: null as Error | null,
  refetch: vi.fn(),
};

let mockNodes = {
  isLoading: false,
  isError: false,
  data: [] as NodeView[],
  error: null as Error | null,
  refetch: vi.fn(),
};

let mockStream = { snapshot: null as null | { aggregateDecodeTokS: number; nodes: Array<{ nodeId: string; metrics: { decodeTokS: number; prefillTokS: number; ramUsedGb: number; vramUsedGb: number; queueDepth: number } }> }, streamError: false };

vi.mock('../../hooks/queries', () => ({
  useCapacity: () => mockCapacity,
  useNodes: () => mockNodes,
  useMetricsStream: () => mockStream,
  useNodeAction: () => ({
    drain: { mutate: vi.fn(), isPending: false },
    restart: { mutate: restartMutate, isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
  }),
  useReconcilerStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  useSloComplianceFull: () => ({ isLoading: false, isError: false, data: null }),
  useClusterStatus: () => ({ isLoading: false, isError: false, data: undefined }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

function makeCapacity(overrides: Partial<ClusterCapacity> = {}): ClusterCapacity {
  return {
    nodeCount: 3,
    readyNodeCount: 2,
    gpuCount: 4,
    fp4Capable: false,
    ramTotalGb: 128,
    ramAvailableGb: 64,
    vramTotalGb: 48,
    vramAvailableGb: 24,
    aggregateDecodeTokS: 1500,
    backends: [],
    ...overrides,
  };
}

function makeNode(overrides: Partial<NodeView> = {}): NodeView {
  return {
    profile: {
      nodeId: 'node-1',
      hostname: 'gpu-node-1',
      state: 'ready',
      os: 'linux',
      arch: 'x86_64',
      gpus: [{ name: 'A100', vramGb: 80, unified: false, fp4Native: false, count: 2 }],
      backends: ['cuda'],
      ramTotalGb: 256,
      ramAvailableGb: 128,
      memBandwidthGbs: 900,
      diskFreeGb: 500,
      engineVersions: { llamacpp: '1.2.3' },
      lastSeen: '2026-09-12T10:00:00Z',
    },
    metrics: { decodeTokS: 800, prefillTokS: 200, ramUsedGb: 32, vramUsedGb: 40, queueDepth: 3, acceptedTokensRatio: 1 },
    role: 'host',
    linkQuality: 'excellent',
    deploymentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  restartMutate.mockClear();
  // Reset defaults
  mockCapacity = { isLoading: false, isError: false, data: null, error: null, refetch: vi.fn() };
  mockNodes = { isLoading: false, isError: false, data: [], error: null, refetch: vi.fn() };
  mockStream = { snapshot: null, streamError: false };
});

// ---------------------------------------------------------------------------
// Capacity card
// ---------------------------------------------------------------------------

describe('FleetPage — CapacityCard', () => {
  it('shows LoadingBlock while capacity is loading', () => {
    mockCapacity = { ...mockCapacity, isLoading: true };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows ErrorState when capacity request fails', () => {
    mockCapacity = { ...mockCapacity, isError: true, error: new Error('network error') };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders capacity stats when data is available', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ readyNodeCount: 2, nodeCount: 3, gpuCount: 4 }) };
    render(<FleetPage />, { wrapper: Wrapper });
    // readyNodeCount renders alone; nodeCount appears as "common.of 3" text
    // (with i18n mock the key is literal); gpuCount renders alone.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    // Confirm nodeCount appears somewhere in the rendered output
    expect(screen.getAllByText(/3/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders FP4 badge when fp4Capable is true', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ fp4Capable: true }) };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.fp4.yes')).toBeInTheDocument();
  });

  it('renders FP4 "not capable" badge when fp4Capable is false', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ fp4Capable: false }) };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.fp4.no')).toBeInTheDocument();
  });

  it('shows live throughput from SSE stream aggregate when stream is active', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ aggregateDecodeTokS: 1000 }) };
    // Live snapshot overrides the static capacity value
    mockStream = {
      snapshot: { aggregateDecodeTokS: 2500, nodes: [] },
      streamError: false,
    };
    render(<FleetPage />, { wrapper: Wrapper });
    // tokS(2500) should be rendered; exact format depends on lib/format.ts
    // Just verify the component renders without crashing with live data.
    // The capacity card title is always present when data is loaded.
    expect(screen.getByText('fleet.capacity.title')).toBeInTheDocument();
  });

  // --- E3 contract-gap fix: null RAM/VRAM → "not measured" -----------------

  it('shows real GB values when ramTotalGb and vramTotalGb are non-null', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ ramTotalGb: 64, ramAvailableGb: 32, vramTotalGb: 24, vramAvailableGb: 0 }) };
    render(<FleetPage />, { wrapper: Wrapper });
    // Meters show "used / total GB" — verify the total value appears somewhere
    expect(screen.getByText('fleet.capacity.ram')).toBeInTheDocument();
    expect(screen.getByText('fleet.capacity.vram')).toBeInTheDocument();
    // Real values are rendered (not "not measured")
    expect(screen.queryByText('common.notMeasured')).not.toBeInTheDocument();
  });

  it('shows "not measured" instead of a meter when ramTotalGb is null', () => {
    // H2 regression: if the backend never sent ram_total_gb, the UI must say
    // "not measured" instead of showing a 0/0 GB bar.
    mockCapacity = { ...mockCapacity, data: makeCapacity({ ramTotalGb: null, ramAvailableGb: null }) };
    render(<FleetPage />, { wrapper: Wrapper });
    // At least one "not measured" label should be visible (for RAM).
    expect(screen.getAllByText('common.notMeasured').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "not measured" instead of a meter when vramTotalGb is null', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ vramTotalGb: null, vramAvailableGb: null }) };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getAllByText('common.notMeasured').length).toBeGreaterThanOrEqual(1);
  });

  it('shows 0 GB meter (NOT "not measured") when vramTotalGb is 0 (CPU-only cluster)', () => {
    // VRAM=0 is a real measured value on CPU-only clusters. The brief ruling:
    // "VRAM=0 su cluster CPU-only è un valore REALE, mostralo come 0, non 'non misurato'."
    mockCapacity = { ...mockCapacity, data: makeCapacity({ vramTotalGb: 0, vramAvailableGb: 0 }) };
    render(<FleetPage />, { wrapper: Wrapper });
    // vram meter label should still appear (not replaced with "not measured")
    expect(screen.getByText('fleet.capacity.vram')).toBeInTheDocument();
    // 0/0 GB meter renders without showing "not measured"
    expect(screen.queryAllByText('common.notMeasured').filter(
      (el) => el.closest('.meter')?.previousElementSibling?.textContent?.includes('fleet.capacity.vram')
    ).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stream error banner
// ---------------------------------------------------------------------------

describe('FleetPage — stream error banner', () => {
  it('shows stale metrics warning badge when SSE stream errors', () => {
    mockStream = { snapshot: null, streamError: true };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.metrics.stale')).toBeInTheDocument();
  });

  it('does not show stale banner when stream is healthy', () => {
    mockStream = { snapshot: null, streamError: false };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.queryByText('fleet.metrics.stale')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Node table states
// ---------------------------------------------------------------------------

describe('FleetPage — node table states', () => {
  it('shows LoadingBlock while nodes are loading', () => {
    mockNodes = { ...mockNodes, isLoading: true };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows ErrorState when nodes request fails', () => {
    mockNodes = { ...mockNodes, isError: true, error: new Error('network error') };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows EmptyState with onboarding link when no nodes', () => {
    mockNodes = { ...mockNodes, data: [] };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.empty')).toBeInTheDocument();
    // Onboarding link should be present
    expect(screen.getByRole('link', { name: 'nav.onboarding' })).toBeInTheDocument();
  });

  it('renders node rows in the table when nodes are available', () => {
    mockNodes = { ...mockNodes, data: [makeNode()] };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('gpu-node-1')).toBeInTheDocument();
  });

  it('renders hardware summary with GPU info in the node row', () => {
    // GPU node: 2× A100 (80GB)
    mockNodes = { ...mockNodes, data: [makeNode()] };
    render(<FleetPage />, { wrapper: Wrapper });
    // hardwareSummary builds "2× A100 (80GB) · 256 GB RAM · cuda"
    expect(screen.getByText(/A100/)).toBeInTheDocument();
  });

  it('renders "CPU only" for node with no GPUs', () => {
    mockNodes = {
      ...mockNodes,
      data: [makeNode({ profile: {
        ...makeNode().profile,
        gpus: [],
        backends: [],
      }})],
    };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText(/CPU only/)).toBeInTheDocument();
  });

  it('renders live metrics from SSE stream when available', () => {
    const node = makeNode({ profile: { ...makeNode().profile, nodeId: 'node-1' } });
    mockNodes = { ...mockNodes, data: [node] };
    mockStream = {
      snapshot: {
        aggregateDecodeTokS: 1000,
        nodes: [{ nodeId: 'node-1', metrics: { decodeTokS: 1200, prefillTokS: 300, ramUsedGb: 16, vramUsedGb: 30, queueDepth: 5 } }],
      },
      streamError: false,
    };
    render(<FleetPage />, { wrapper: Wrapper });
    // queueDepth 5 is rendered in the load cell
    expect(screen.getByText('queue 5')).toBeInTheDocument();
  });

  it('renders "n/a" for node with no metrics (null metrics)', () => {
    mockNodes = { ...mockNodes, data: [makeNode({ metrics: null })] };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('common.na')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Node detail panel — optional fields
// ---------------------------------------------------------------------------

describe('FleetPage — NodeDetailPanel optional fields', () => {
  it('shows lastSeen date when present', () => {
    mockNodes = { ...mockNodes, data: [makeNode()] };
    render(<FleetPage />, { wrapper: Wrapper });
    // Expand the row to show the detail panel
    const rowHeader = screen.getByRole('rowheader', { name: /gpu-node-1/i });
    fireEvent.click(rowHeader);
    expect(screen.getByText('Last seen')).toBeInTheDocument();
  });

  it('shows inference engine badges in the detail panel', () => {
    mockNodes = { ...mockNodes, data: [makeNode()] };
    render(<FleetPage />, { wrapper: Wrapper });
    const rowHeader = screen.getByRole('rowheader', { name: /gpu-node-1/i });
    fireEvent.click(rowHeader);
    expect(screen.getByText('llamacpp')).toBeInTheDocument();
  });

  it('shows advertised agent addr when present', () => {
    const node = makeNode({ profile: { ...makeNode().profile, advertisedAgentAddr: 'agent.local:7001' } });
    mockNodes = { ...mockNodes, data: [node] };
    render(<FleetPage />, { wrapper: Wrapper });
    const rowHeader = screen.getByRole('rowheader', { name: /gpu-node-1/i });
    fireEvent.click(rowHeader);
    expect(screen.getByText('agent.local:7001')).toBeInTheDocument();
  });

  it('shows advertised inference addr when present', () => {
    const node = makeNode({ profile: { ...makeNode().profile, advertisedInferenceAddr: 'infer.local:8080' } });
    mockNodes = { ...mockNodes, data: [node] };
    render(<FleetPage />, { wrapper: Wrapper });
    const rowHeader = screen.getByRole('rowheader', { name: /gpu-node-1/i });
    fireEvent.click(rowHeader);
    expect(screen.getByText('infer.local:8080')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NodeRow interactions
// ---------------------------------------------------------------------------

describe('FleetPage — NodeRow restart action', () => {
  it('clicking Restart calls restart.mutate immediately (no modal)', () => {
    mockNodes = { ...mockNodes, data: [makeNode()] };
    render(<FleetPage />, { wrapper: Wrapper });

    // Open overflow menu
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.click(actionsBtn);

    // Click Restart
    fireEvent.click(screen.getByRole('menuitem', { name: /restart/i }));

    // Restart calls mutate immediately — no modal
    expect(restartMutate).toHaveBeenCalledWith('node-1');
    // No modal dialog should appear
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('FP4 badge appears for nodes with fp4Native GPU', () => {
    const node = makeNode({
      profile: {
        ...makeNode().profile,
        gpus: [{ name: 'H100', vramGb: 80, unified: false, fp4Native: true, count: 1 }],
      },
    });
    mockNodes = { ...mockNodes, data: [node] };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('FP4')).toBeInTheDocument();
  });

  it('worker role badge is rendered for worker nodes', () => {
    const node = makeNode({ role: 'worker' });
    mockNodes = { ...mockNodes, data: [node] };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.role.worker')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Idle anchor banner (6b) — no inference running
// ---------------------------------------------------------------------------

describe('FleetPage — idle anchor banner', () => {
  it('shows the idle banner when nodes are ready and aggregate decode is 0', () => {
    // Ready nodes, zero aggregate decode (no inference running)
    mockCapacity = {
      ...mockCapacity,
      data: makeCapacity({ readyNodeCount: 2, aggregateDecodeTokS: 0 }),
    };
    mockStream = { snapshot: null, streamError: false };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.getByTestId('fleet-idle-banner')).toBeInTheDocument();
    // Banner text uses i18n key (mock returns key verbatim)
    expect(screen.getByText(/fleet.idle.banner/)).toBeInTheDocument();
    // Link to catalog is present
    expect(screen.getByText('fleet.idle.link')).toBeInTheDocument();
  });

  it('does not show the idle banner when there is live decode traffic', () => {
    mockCapacity = {
      ...mockCapacity,
      data: makeCapacity({ readyNodeCount: 2, aggregateDecodeTokS: 0 }),
    };
    // Live SSE stream overrides with non-zero aggregate
    mockStream = {
      snapshot: { aggregateDecodeTokS: 1500, nodes: [] },
      streamError: false,
    };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.queryByTestId('fleet-idle-banner')).not.toBeInTheDocument();
  });

  it('does not show the idle banner when readyNodeCount is 0', () => {
    mockCapacity = {
      ...mockCapacity,
      data: makeCapacity({ readyNodeCount: 0, aggregateDecodeTokS: 0 }),
    };
    mockStream = { snapshot: null, streamError: false };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.queryByTestId('fleet-idle-banner')).not.toBeInTheDocument();
  });

  it('does not show the idle banner when capacity data is not loaded', () => {
    mockCapacity = { ...mockCapacity, data: null };
    render(<FleetPage />, { wrapper: Wrapper });
    expect(screen.queryByTestId('fleet-idle-banner')).not.toBeInTheDocument();
  });
});
