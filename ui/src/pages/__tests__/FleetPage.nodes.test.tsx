/**
 * FleetPage — decommissioned node clarity tests (U3 / v0.7).
 *
 * Verifies:
 * 1. "X of Y ready" summary is shown above the node table.
 * 2. Decommissioned nodes show a "Retired" label.
 * 3. Ready nodes appear before decommissioned nodes in the DOM (ordering).
 *
 * Mock setup: 2 ready nodes (ready-1, ready-2) + 2 decommissioned nodes (decom-1, decom-2).
 */
import { render, screen } from '@testing-library/react';
import { FleetPage } from '../FleetPage';
import { I18nProvider } from '../../i18n';
import type { ReactNode } from 'react';
import type { NodeView } from '../../api/types';

// ---- helpers ---------------------------------------------------------------

function makeNode(
  id: string,
  hostname: string,
  state: 'ready' | 'decommissioned',
): NodeView {
  return {
    profile: {
      nodeId: id,
      hostname,
      state,
      os: 'linux',
      arch: 'x86_64',
      gpus: [],
      backends: ['cpu'],
      ramTotalGb: 32,
      ramAvailableGb: 16,
      memBandwidthGbs: 0,
      diskFreeGb: 100,
      engineVersions: {},
      lastSeen: '',
    },
    metrics: null,
    role: null,
    linkQuality: 'good',
    deploymentId: null,
  };
}

const MIXED_NODES: NodeView[] = [
  // deliberately start with decommissioned so the sort is observable
  makeNode('decom-1', 'decom-node-1', 'decommissioned'),
  makeNode('ready-1', 'ready-node-1', 'ready'),
  makeNode('decom-2', 'decom-node-2', 'decommissioned'),
  makeNode('ready-2', 'ready-node-2', 'ready'),
];

// ---- mock hooks/queries ----------------------------------------------------

vi.mock('../../hooks/queries', () => ({
  useCapacity: () => ({ isLoading: false, isError: false, data: null }),
  useNodes: () => ({
    isLoading: false,
    isError: false,
    data: MIXED_NODES,
    refetch: vi.fn(),
  }),
  useMetricsStream: () => ({ snapshot: null, streamError: false }),
  useNodeAction: () => ({
    drain: { mutate: vi.fn(), isPending: false },
    restart: { mutate: vi.fn(), isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
  }),
  useReconcilerStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  useSloComplianceFull: () => ({ isLoading: false, isError: false, data: null }),
  useClusterStatus: () => ({ isLoading: false, isError: false, data: undefined }),
}));

// ---- setup -----------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

// ---- tests -----------------------------------------------------------------

describe('FleetPage — decommissioned node clarity (U3)', () => {
  it('shows "2 of 4 ready" summary above the node table', () => {
    render(<FleetPage />, { wrapper: Wrapper });
    // The summary should state how many nodes are ready out of total.
    expect(screen.getByText(/2 of 4 ready/i)).toBeInTheDocument();
  });

  it('shows "Retired" label next to each decommissioned node', () => {
    render(<FleetPage />, { wrapper: Wrapper });
    // There are 2 decommissioned nodes — both should have the "Retired" label.
    const retiredLabels = screen.getAllByText(/retired/i);
    expect(retiredLabels).toHaveLength(2);
  });

  it('ready nodes appear before decommissioned nodes in the DOM', () => {
    render(<FleetPage />, { wrapper: Wrapper });

    // Get all node row headers (th[scope="row"]) in DOM order.
    const rowHeaders = screen.getAllByRole('rowheader');
    // Extract hostnames from text content (the rowheader contains the hostname).
    const hostnames = rowHeaders.map((el) => el.textContent ?? '');

    const readyIndices = hostnames
      .map((h, i) => (h.includes('ready-node') ? i : -1))
      .filter((i) => i !== -1);
    const decomIndices = hostnames
      .map((h, i) => (h.includes('decom-node') ? i : -1))
      .filter((i) => i !== -1);

    // Every ready-node row index must be less than every decom-node row index.
    expect(readyIndices.length).toBe(2);
    expect(decomIndices.length).toBe(2);
    const lastReadyIndex = Math.max(...readyIndices);
    const firstDecomIndex = Math.min(...decomIndices);
    expect(lastReadyIndex).toBeLessThan(firstDecomIndex);
  });
});
