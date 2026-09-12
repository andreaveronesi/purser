/**
 * FleetPage — SloStatusCard crash regression (TDD wave 1).
 *
 * Reproduces the live crash: visiting /fleet threw
 *   TypeError: Cannot read properties of undefined (reading 'toFixed')
 * because the pre-fix SloStatusCard called the flat legacy hook but the backend
 * returns the nested shape (SloModelEntry); rendering the non-existent flat field
 * m.ttft_actual_compliance_pct.toFixed(1) threw on the real shape.
 *
 * Test order (TDD): written failing-first against the REAL backend nested shape,
 * then FleetPage was switched to useSloComplianceFull + a null guard so it renders
 * the compliance percentage (or '—' when ttft_compliance is null) instead of crashing.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FleetPage } from '../FleetPage';
import { I18nProvider } from '../../i18n';
import type { ReactNode } from 'react';
import type { SloApiResponse } from '../../api/types';

// ---- fixtures ---------------------------------------------------------------

/** Mirrors the REAL backend shape from go/controlplane/server/slo.go */
const SLO_RESPONSE: SloApiResponse = {
  window_hours: 24,
  generated_at: '2026-09-12T07:03:11Z',
  models: [
    {
      model_id: 'llama3-8b',
      slo: { ttft_ms: 2000, tbt_ms: 500, target_compliance: 0.95 },
      actual: {
        ttft_compliance: 0.987,   // 98.7%
        tbt_compliance: null,
        request_count: 1420,
        period_start: '2026-09-11T00:00:00Z',
      },
      status: 'met',
    },
    {
      model_id: 'qwen3-235b',
      slo: { ttft_ms: 1500, tbt_ms: 400, target_compliance: 0.95 },
      actual: {
        ttft_compliance: null,    // insufficient data → render '—'
        tbt_compliance: null,
        request_count: 3,
        period_start: '2026-09-11T00:00:00Z',
      },
      status: 'insufficient_data',
    },
  ],
};

// ---- mock all hooks/queries -------------------------------------------------
//
// useSloCompliance receives the REAL backend nested shape.
// Before the fix: FleetPage calls this hook and crashes on .ttft_actual_compliance_pct.
// After the fix:  FleetPage calls useSloComplianceFull instead.

vi.mock('../../hooks/queries', () => ({
  useCapacity: () => ({ isLoading: false, isError: false, data: null }),
  useNodes: () => ({
    isLoading: false,
    isError: false,
    data: [],
    refetch: vi.fn(),
  }),
  useMetricsStream: () => ({ snapshot: null, streamError: false }),
  useNodeAction: () => ({
    drain: { mutate: vi.fn(), isPending: false },
    restart: { mutate: vi.fn(), isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
  }),
  useReconcilerStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  useClusterStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  // FleetPage's SloStatusCard consumes the nested v0.6 shape via useSloComplianceFull.
  // Feeding the REAL backend nested shape here is what reproduced the original crash
  // (the pre-fix code read the non-existent flat field m.ttft_actual_compliance_pct).
  useSloComplianceFull: () => ({ isLoading: false, isError: false, data: SLO_RESPONSE }),
}));

// ---- wrapper ----------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

// ---- tests ------------------------------------------------------------------

describe('FleetPage — SloStatusCard crash regression', () => {
  it('renders without throwing when backend returns nested SLO shape', () => {
    // Before fix: this throws TypeError: Cannot read properties of undefined
    //             (reading 'toFixed') because ttft_actual_compliance_pct is missing.
    // After fix:  FleetPage uses useSloComplianceFull + guards actual.ttft_compliance.
    expect(() => render(<FleetPage />, { wrapper: Wrapper })).not.toThrow();
  });

  it('renders compliance percentage for models with data (98.7%)', () => {
    render(<FleetPage />, { wrapper: Wrapper });
    // llama3-8b: actual.ttft_compliance = 0.987 → (0.987 * 100).toFixed(1) = "98.7"
    expect(screen.getByText('98.7%')).toBeInTheDocument();
  });

  it('renders "—" for models with null ttft_compliance (insufficient data)', () => {
    render(<FleetPage />, { wrapper: Wrapper });
    // qwen3-235b: actual.ttft_compliance = null → render '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
