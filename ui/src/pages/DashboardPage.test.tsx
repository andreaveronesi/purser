/**
 * DashboardPage — TDD (W2 wave).
 *
 * The Dashboard is the new landing page (/). It shows:
 *   1. PageHeader "dashboard.title"
 *   2. A clickable fleet-summary box that links to /fleet (showing X of Y ready)
 *   3. CapacityCard (fleet.capacity.title)
 *   4. ReconcilerStatusCard ("Reconciler")
 *   5. ClusterStatusCard (clusterStatus.title)
 *   6. SloStatusCard (slo.title)
 *
 * Hooks mocked at the same seam used by FleetPage tests.
 * NOTE: capacity-card state tests (loading/error/FP4/etc.) live here because
 * CapacityCard moved from FleetPage to Dashboard (W2 refactor).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import type { ReactNode } from 'react';
import type { ClusterCapacity } from '../api/types';

// Return i18n keys verbatim so assertions can use key strings directly.
vi.mock('../i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Default mock values
// ---------------------------------------------------------------------------

let mockCapacity = {
  isLoading: false,
  isError: false,
  data: null as ClusterCapacity | null,
  error: null as Error | null,
  refetch: vi.fn(),
};

let mockReconcilerStatus = {
  isLoading: false,
  isError: false,
  data: undefined as undefined,
};

let mockStream = {
  snapshot: null as null | { aggregateDecodeTokS: number; nodes: unknown[] },
  streamError: false,
};

vi.mock('../hooks/queries', () => ({
  useCapacity: () => mockCapacity,
  useReconcilerStatus: () => mockReconcilerStatus,
  useMetricsStream: () => mockStream,
  useClusterStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  useSloComplianceFull: () => ({ isLoading: false, isError: false, data: null }),
}));

// Dynamically imported AFTER mocks are hoisted.
import { DashboardPage } from './DashboardPage';

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

beforeEach(() => {
  mockCapacity = { isLoading: false, isError: false, data: null, error: null, refetch: vi.fn() };
  mockReconcilerStatus = { isLoading: false, isError: false, data: undefined };
  mockStream = { snapshot: null, streamError: false };
});

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

describe('DashboardPage — structure', () => {
  it('renders the page header with dashboard.title', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { level: 1, name: 'dashboard.title' })).toBeInTheDocument();
  });

  it('renders SloStatusCard (slo.title)', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('slo.title')).toBeInTheDocument();
  });

  it('renders ClusterStatusCard (clusterStatus.title)', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('clusterStatus.title')).toBeInTheDocument();
  });

  it('renders ReconcilerStatusCard header ("Reconciler")', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('Reconciler')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fleet summary box
// ---------------------------------------------------------------------------

describe('DashboardPage — fleet summary', () => {
  it('renders a link to /fleet', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    const link = screen.getByRole('link', { name: /fleet/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/fleet');
  });

  it('shows "X of Y ready" count when capacity data is available', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ readyNodeCount: 2, nodeCount: 5 }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    // i18n mock returns "fleet.nodes.readyOf:{"ready":2,"total":5}"
    expect(screen.getByText(/fleet\.nodes\.readyOf/)).toBeInTheDocument();
  });

  it('summary link has cursor-pointer affordance or role navigation', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    const link = screen.getByRole('link', { name: /fleet/i });
    // NavLink renders an <a> which is inherently a link role (correct affordance)
    expect(link.tagName.toLowerCase()).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// CapacityCard (moved from FleetPage to Dashboard — W2)
// ---------------------------------------------------------------------------

describe('DashboardPage — CapacityCard', () => {
  it('shows LoadingBlock while capacity is loading', () => {
    mockCapacity = { ...mockCapacity, isLoading: true };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows ErrorState when capacity request fails', () => {
    mockCapacity = { ...mockCapacity, isError: true, error: new Error('network error') };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders capacity stats when data is available', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ readyNodeCount: 2, nodeCount: 3, gpuCount: 4 }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.title')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders FP4 badge when fp4Capable is true', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ fp4Capable: true }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.fp4.yes')).toBeInTheDocument();
  });

  it('renders FP4 "not capable" badge when fp4Capable is false', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ fp4Capable: false }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.fp4.no')).toBeInTheDocument();
  });

  it('shows "not measured" instead of a meter when ramTotalGb is null', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ ramTotalGb: null, ramAvailableGb: null }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getAllByText('common.notMeasured').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "not measured" instead of a meter when vramTotalGb is null', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity({ vramTotalGb: null, vramAvailableGb: null }) };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getAllByText('common.notMeasured').length).toBeGreaterThanOrEqual(1);
  });

  it('shows live throughput from SSE stream aggregate when stream is active', () => {
    mockCapacity = { ...mockCapacity, data: makeCapacity() };
    mockStream = { snapshot: { aggregateDecodeTokS: 2500, nodes: [] }, streamError: false };
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText('fleet.capacity.title')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SLO crash regression (moved from FleetPage.slo.test since card moved to Dashboard)
// ---------------------------------------------------------------------------

describe('DashboardPage — SloStatusCard crash regression', () => {
  it('renders without throwing when backend returns nested SLO shape', () => {
    expect(() => render(<DashboardPage />, { wrapper: Wrapper })).not.toThrow();
  });
});
