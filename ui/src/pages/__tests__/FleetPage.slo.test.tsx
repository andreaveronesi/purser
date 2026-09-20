/**
 * DashboardPage — SloStatusCard crash regression (moved from FleetPage, W2 refactor).
 *
 * Reproduces the original crash: visiting /fleet (now /dashboard) threw
 *   TypeError: Cannot read properties of undefined (reading 'toFixed')
 * because the pre-fix SloStatusCard read the non-existent flat field
 * m.ttft_actual_compliance_pct. After the fix, useSloComplianceFull is used
 * with a null guard so compliance percentage renders correctly.
 *
 * W2 note: SloStatusCard moved from FleetPage → DashboardPage. Tests updated
 * to render DashboardPage which hosts the card.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../DashboardPage';
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
  useReconcilerStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  useMetricsStream: () => ({ snapshot: null, streamError: false }),
  useClusterStatus: () => ({ isLoading: false, isError: false, data: undefined }),
  // DashboardPage's SloStatusCard consumes the nested v0.6 shape via useSloComplianceFull.
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

describe('DashboardPage — SloStatusCard crash regression', () => {
  it('renders without throwing when backend returns nested SLO shape', () => {
    // Before fix: this throws TypeError: Cannot read properties of undefined
    //             (reading 'toFixed') because ttft_actual_compliance_pct is missing.
    // After fix:  DashboardPage's SloStatusCard uses useSloComplianceFull + guards.
    expect(() => render(<DashboardPage />, { wrapper: Wrapper })).not.toThrow();
  });

  it('renders compliance percentage for models with data (98.7%)', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    // llama3-8b: actual.ttft_compliance = 0.987 → (0.987 * 100).toFixed(1) = "98.7"
    expect(screen.getByText('98.7%')).toBeInTheDocument();
  });

  it('renders "—" for models with null ttft_compliance (insufficient data)', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    // qwen3-235b: actual.ttft_compliance = null → render '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
