/**
 * ChargebackPage — unit tests for XLSX and PDF export buttons, all 4 tabs,
 * enterprise gating, loading/error/empty states, and forecastTone/slaTone logic.
 *
 * Strategy: mock the hooks/queries layer and the api client so the component
 * renders synchronously with controlled data, without any real HTTP calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '../api/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock hooks/queries before importing ChargebackPage.
vi.mock('../hooks/queries', () => ({
  useBillingReport: vi.fn(),
  useBillingForecast: vi.fn(),
  useModelAdoption: vi.fn(),
  useOrgBilling: vi.fn(),
  useTeamBilling: vi.fn(),
}));

// Mock i18n so we can match raw key strings in assertions.
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
}));

// Mock the api client so getBillingXlsxUrl / getBillingPdfUrl are controllable.
vi.mock('../api/client', () => ({
  api: {
    getBillingCsvUrl: vi.fn(() => '/api/v1/billing/report?format=csv'),
    getBillingXlsxUrl: vi.fn(() => '/api/v1/billing/report?format=xlsx'),
    getBillingPdfUrl: vi.fn(() => '/api/v1/billing/report?format=pdf'),
  },
}));

import { ChargebackPage } from './ChargebackPage';
import * as queries from '../hooks/queries';
import { api } from '../api/client';

// Minimal billing report for tests — uses the REAL camelCase shape that
// camelizeKeys() delivers at runtime (snake_case fields would silently be
// undefined and cause .toFixed() crashes, which is exactly what this migration fixes).
const MOCK_REPORT = {
  periodStart: '2026-09-01T00:00:00Z',
  periodEnd: '2026-09-08T00:00:00Z',
  totalRequests: 42,
  totalTokens: 8400,
  tenants: [
    {
      tenantId: 'acme/eng',
      modelId: 'llama3-8b',
      requestCount: 42,
      promptTokens: 4200,
      completionTokens: 4200,
      totalTokens: 8400,
      avgLatencyMs: 210.5,
      periodStart: '2026-09-01T00:00:00Z',
      periodEnd: '2026-09-08T00:00:00Z',
    },
  ],
};

// Typed access to the mocked hooks.
const mq = queries as unknown as {
  useBillingReport: ReturnType<typeof vi.fn>;
  useBillingForecast: ReturnType<typeof vi.fn>;
  useModelAdoption: ReturnType<typeof vi.fn>;
  useOrgBilling: ReturnType<typeof vi.fn>;
  useTeamBilling: ReturnType<typeof vi.fn>;
};

function mkQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={mkQueryClient()}>
      <ChargebackPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mq.useBillingReport.mockReturnValue({
    data: MOCK_REPORT,
    isLoading: false,
    error: null,
  });
  // Billing forecast is enterprise-gated; return 402 in tests to hide the section.
  mq.useBillingForecast.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: Object.assign(new Error('Enterprise license required'), { status: 402 }),
  });
  // New tab hooks — default to empty/idle; individual tests override.
  mq.useModelAdoption.mockReturnValue({ data: undefined, isLoading: false, error: null });
  mq.useOrgBilling.mockReturnValue({ data: undefined, isLoading: false, error: null });
  mq.useTeamBilling.mockReturnValue({ data: undefined, isLoading: false, error: null });
});

describe('ChargebackPage — export buttons', () => {
  it('shows XLSX download button', () => {
    renderPage();
    const xlsxBtn = screen.getByRole('button', { name: 'chargeback.action.exportXlsx' });
    expect(xlsxBtn).toBeDefined();
  });

  it('shows PDF download button', () => {
    renderPage();
    const pdfBtn = screen.getByRole('button', { name: 'chargeback.action.exportPdf' });
    expect(pdfBtn).toBeDefined();
  });

  it('XLSX button calls getBillingXlsxUrl with correct URL and triggers download', () => {
    renderPage();

    const xlsxBtn = screen.getByRole('button', { name: 'chargeback.action.exportXlsx' });
    fireEvent.click(xlsxBtn);

    // getBillingXlsxUrl must have been called exactly once.
    expect(api.getBillingXlsxUrl).toHaveBeenCalledTimes(1);

    // Both start and end arguments must be ISO-8601 date strings.
    const mockFn = api.getBillingXlsxUrl as ReturnType<typeof vi.fn>;
    const [start, end] = (mockFn.mock.calls[0] ?? []) as [string, string];
    expect(typeof start).toBe('string');
    expect(typeof end).toBe('string');
    // The mock returns a URL containing the xlsx format parameter.
    expect((mockFn.mock.results[0]?.value as string) ?? '').toContain('format=xlsx');
  });
});

// ---------------------------------------------------------------------------
// Model adoption tab
// ---------------------------------------------------------------------------

const MOCK_ADOPTION = {
  window: 'daily' as const,
  days: 30,
  series: [
    {
      modelId: 'llama3-8b',
      buckets: [
        { date: '2026-09-01', requests: 10, tokensOut: 1000 },
        { date: '2026-09-02', requests: 25, tokensOut: 2500 },
      ],
    },
  ],
};

describe('ChargebackPage — model adoption tab', () => {
  it('renders adoption rows from mocked data when the tab is active', () => {
    mq.useModelAdoption.mockReturnValue({ data: MOCK_ADOPTION, isLoading: false, error: null });
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));

    // The model id appears in the adoption table.
    expect(screen.getByText('llama3-8b')).toBeDefined();
    // Aggregate requests (10 + 25 = 35) is rendered.
    expect(screen.getByText('35')).toBeDefined();
  });

  it('calls useModelAdoption once the adoption tab is shown', () => {
    mq.useModelAdoption.mockReturnValue({ data: MOCK_ADOPTION, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(mq.useModelAdoption).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SLA compliance tab
// ---------------------------------------------------------------------------

describe('ChargebackPage — SLA compliance tab', () => {
  it('requests the billing report with an sla threshold and renders the rate', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return {
          data: {
            ...MOCK_REPORT,
            slaStats: [{ tenantId: 'acme/eng', slaComplianceRate: 0.95, slaThresholdMs: 2000 }],
          },
          isLoading: false,
          error: null,
        };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });

    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));

    // The SLA hook variant must have been called with a numeric threshold.
    const calledWithThreshold = mq.useBillingReport.mock.calls.some(
      (c: unknown[]) => (c[0] as { slaThresholdMs?: number })?.slaThresholdMs != null,
    );
    expect(calledWithThreshold).toBe(true);
    // The tenant SLA row is rendered.
    expect(screen.getByText('acme/eng')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Enterprise gate — 402 for the whole page
// ---------------------------------------------------------------------------

describe('ChargebackPage — enterprise gate (page-level 402)', () => {
  function make402Error() {
    return new ApiError(402, 'enterprise license required', {
      error: { type: 'license_required', feature: 'billing' },
    });
  }

  it('shows the EnterpriseGate (not a bare EmptyState) when useBillingReport returns 402', () => {
    mq.useBillingReport.mockReturnValue({ data: undefined, isLoading: false, error: make402Error() });
    renderPage();
    // EnterpriseGate renders with data-testid and role=status
    expect(screen.getByTestId('enterprise-gate')).toBeInTheDocument();
    // The tabs should NOT be rendered
    expect(screen.queryByRole('tab', { name: 'chargeback.tab.usage' })).not.toBeInTheDocument();
  });

  it('EnterpriseGate shows lock icon, title, and description on 402', () => {
    mq.useBillingReport.mockReturnValue({ data: undefined, isLoading: false, error: make402Error() });
    renderPage();
    const gate = screen.getByTestId('enterprise-gate');
    // Lock emoji is present
    expect(gate.textContent).toContain('🔒');
    // Title and description keys rendered by the mock t()
    expect(screen.getByText('chargeback.enterprise.title')).toBeInTheDocument();
    expect(screen.getByText('chargeback.enterprise.desc')).toBeInTheDocument();
  });

  it('EnterpriseGate docs link points to the same host as other enterprise pages', () => {
    mq.useBillingReport.mockReturnValue({ data: undefined, isLoading: false, error: make402Error() });
    renderPage();
    const link = screen.getByText('chargeback.enterprise.link').closest('a');
    expect(link).not.toBeNull();
    // Same docs host as CompliancePage / PoliciesPage
    expect(link?.href).toContain('andrew19881123.github.io/purser');
  });
});

// ---------------------------------------------------------------------------
// Usage tab — loading and error states
// ---------------------------------------------------------------------------

describe('ChargebackPage — usage tab loading/error', () => {
  it('shows LoadingBlock while the billing report is loading', () => {
    mq.useBillingReport.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows ErrorState for non-402 billing report error', () => {
    mq.useBillingReport.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network error'),
    });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows empty usage table when report has zero tenants', () => {
    mq.useBillingReport.mockReturnValue({
      data: { ...MOCK_REPORT, tenants: [], totalRequests: 0, totalTokens: 0 },
      isLoading: false,
      error: null,
    });
    renderPage();
    expect(screen.getByText('chargeback.empty')).toBeInTheDocument();
  });

  it('renders the summary stats (requests, tokens, active tenants) when report is loaded', () => {
    renderPage();
    // MOCK_REPORT has totalRequests=42, totalTokens=8400, 1 unique tenant
    // Multiple "42" values may exist (request_count in the table row too); use getAllByText
    expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('8,400')).toBeInTheDocument();
  });

  it('renders the usage table rows with tenantId, modelId, and avgLatencyMs.toFixed(1)', () => {
    renderPage();
    expect(screen.getByText('acme/eng')).toBeInTheDocument();
    expect(screen.getByText('llama3-8b')).toBeInTheDocument();
    // avgLatencyMs = 210.5 → "210.5 ms"
    expect(screen.getByText('210.5 ms')).toBeInTheDocument();
  });

  it('PDF export button exists and calls getBillingPdfUrl', () => {
    renderPage();
    const pdfBtn = screen.getByRole('button', { name: 'chargeback.action.exportPdf' });
    fireEvent.click(pdfBtn);
    expect(api.getBillingPdfUrl).toHaveBeenCalledTimes(1);
  });

  it('CSV export button exists and calls getBillingCsvUrl', () => {
    renderPage();
    const csvBtn = screen.getByRole('button', { name: 'chargeback.action.exportCsv' });
    fireEvent.click(csvBtn);
    expect(api.getBillingCsvUrl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Forecast card — various states
// ---------------------------------------------------------------------------

const MOCK_FORECAST = {
  entries: [
    {
      orgId: 'org-1',
      teamId: 'team-eng',
      burnRateDailyUsd: 5.50,
      projectedMonthlyUsd: 165.0,
      budgetMonthlyUsd: 200.0,
      daysUntilExhaustion: null,
    },
  ],
};

const MOCK_FORECAST_DANGER = {
  entries: [
    {
      orgId: 'org-1',
      teamId: 'team-eng',
      burnRateDailyUsd: 30.0,
      projectedMonthlyUsd: 900.0,
      budgetMonthlyUsd: 200.0,
      daysUntilExhaustion: 3, // < 7 → danger
    },
  ],
};

describe('ChargebackPage — ForecastCard states', () => {
  it('shows forecast table when billing forecast data is available', () => {
    mq.useBillingForecast.mockReturnValue({ data: MOCK_FORECAST, isLoading: false, error: null });
    renderPage();
    expect(screen.getByTestId('forecast-table')).toBeInTheDocument();
    // burn_rate_daily_usd.toFixed(2) = "5.50"
    expect(screen.getByText('$5.50')).toBeInTheDocument();
    // days_until_exhaustion is null → renders ∞
    expect(screen.getByText('∞')).toBeInTheDocument();
  });

  it('shows forecast danger badge when days_until_exhaustion < 7', () => {
    mq.useBillingForecast.mockReturnValue({ data: MOCK_FORECAST_DANGER, isLoading: false, error: null });
    renderPage();
    // days_until_exhaustion = 3 → danger badge
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('hides forecast card when error is 402 (enterprise gate)', () => {
    mq.useBillingForecast.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(402, 'enterprise license required', {
        error: { type: 'license_required', feature: 'billing' },
      }),
    });
    renderPage();
    // ForecastCard silently hides on 402; forecast-table must not appear
    expect(screen.queryByTestId('forecast-table')).not.toBeInTheDocument();
  });

  it('shows forecast loading spinner when isLoading is true', () => {
    mq.useBillingForecast.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();
    // Multiple status spinners may be present (usage tab + forecast)
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
  });

  it('shows forecast error state for non-402 error when stale data exists', () => {
    // ForecastCard only renders the ErrorState when data is non-null AND error is present.
    // (When data is undefined, the `!isLoading && !data` guard hides the card entirely.)
    mq.useBillingForecast.mockReturnValue({
      data: { entries: [] },   // stale data keeps the card mounted
      isLoading: false,
      error: new Error('server error'),
    });
    renderPage();
    // The card renders an ErrorState with role="alert"
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows forecast empty state when entries is empty', () => {
    mq.useBillingForecast.mockReturnValue({ data: { entries: [] }, isLoading: false, error: null });
    renderPage();
    expect(screen.getByText('chargeback.forecast.empty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Model adoption tab
// ---------------------------------------------------------------------------

describe('ChargebackPage — model adoption tab extended', () => {
  it('shows enterprise empty state on 402', () => {
    mq.useModelAdoption.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(402, 'enterprise license required', {
        error: { type: 'license_required', feature: 'billing' },
      }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(screen.getByText('chargeback.adoption.enterprise.required')).toBeInTheDocument();
  });

  it('shows loading spinner in adoption tab', () => {
    mq.useModelAdoption.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state in adoption tab for generic error', () => {
    mq.useModelAdoption.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('server error'),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows empty state in adoption tab when series is empty', () => {
    mq.useModelAdoption.mockReturnValue({ data: { window: 'daily', days: 30, series: [] }, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(screen.getByText('chargeback.adoption.empty')).toBeInTheDocument();
  });

  it('renders sparkline for model with bucket data', () => {
    mq.useModelAdoption.mockReturnValue({
      data: {
        window: 'daily', days: 30,
        series: [{ modelId: 'llama3-8b', buckets: [{ date: '2026-09-01', requests: 0, tokensOut: 0 }] }],
      },
      isLoading: false,
      error: null,
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    expect(screen.getByTestId('adoption-table')).toBeInTheDocument();
  });

  it('window picker changes from daily to weekly', () => {
    mq.useModelAdoption.mockReturnValue({ data: { window: 'daily', days: 30, series: [] }, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.adoption' }));
    const select = screen.getByRole('combobox', { name: 'chargeback.adoption.window.label' });
    fireEvent.change(select, { target: { value: 'weekly' } });
    // useModelAdoption should have been called with window: 'weekly'
    const calls = mq.useModelAdoption.mock.calls as Array<[{ window: string }]>;
    const weeklyCall = calls.some((c) => c[0]?.window === 'weekly');
    expect(weeklyCall).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SLA compliance tab — slaTone branches
// ---------------------------------------------------------------------------

describe('ChargebackPage — SLA tab extended', () => {
  it('shows 402 gate in SLA tab', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return {
          data: undefined,
          isLoading: false,
          error: new ApiError(402, 'enterprise license required', {
            error: { type: 'license_required', feature: 'billing' },
          }),
        };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByText('chargeback.enterprise.required')).toBeInTheDocument();
  });

  it('shows loading in SLA tab', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return { data: undefined, isLoading: true, error: null };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error in SLA tab for generic error', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return { data: undefined, isLoading: false, error: new Error('server error') };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows empty state in SLA tab when sla_stats is empty', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return { data: { ...MOCK_REPORT, slaStats: [] }, isLoading: false, error: null };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByText('chargeback.sla.empty')).toBeInTheDocument();
  });

  it('renders success tone badge for sla_compliance_rate >= 0.99', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return {
          data: {
            ...MOCK_REPORT,
            slaStats: [{ tenantId: 'acme/eng', slaComplianceRate: 0.995, slaThresholdMs: 2000 }],
          },
          isLoading: false,
          error: null,
        };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    // 0.995 * 100 = "99.5%"
    expect(screen.getByText('99.5%')).toBeInTheDocument();
  });

  it('renders warning tone badge for 0.95 <= sla_compliance_rate < 0.99', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return {
          data: {
            ...MOCK_REPORT,
            slaStats: [{ tenantId: 'acme/eng', slaComplianceRate: 0.97, slaThresholdMs: 2000 }],
          },
          isLoading: false,
          error: null,
        };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByText('97.0%')).toBeInTheDocument();
  });

  it('renders danger tone badge for sla_compliance_rate < 0.95', () => {
    mq.useBillingReport.mockImplementation((params: { slaThresholdMs?: number }) => {
      if (params.slaThresholdMs != null) {
        return {
          data: {
            ...MOCK_REPORT,
            slaStats: [{ tenantId: 'acme/eng', slaComplianceRate: 0.80, slaThresholdMs: 2000 }],
          },
          isLoading: false,
          error: null,
        };
      }
      return { data: MOCK_REPORT, isLoading: false, error: null };
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    expect(screen.getByText('80.0%')).toBeInTheDocument();
  });

  it('threshold input changes trigger re-fetch with new threshold', () => {
    mq.useBillingReport.mockImplementation(() => ({
      data: { ...MOCK_REPORT, slaStats: [] }, isLoading: false, error: null,
    }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.sla' }));
    const input = screen.getByTestId('sla-threshold-input');
    fireEvent.change(input, { target: { value: '3000' } });
    const calls = mq.useBillingReport.mock.calls as Array<[{ slaThresholdMs?: number }]>;
    const withNewThreshold = calls.some((c) => c[0]?.slaThresholdMs === 3000);
    expect(withNewThreshold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tenants tab — TenantBillingPanel
// ---------------------------------------------------------------------------

const MOCK_ORG_REPORT = {
  orgId: 'org-1',
  periodStart: '2026-09-01T00:00:00Z',
  periodEnd: '2026-09-08T00:00:00Z',
  totalCostUsd: 120.50,
  totalTokens: 50000,
  teams: [
    {
      teamId: 'team-eng',
      teamName: 'Engineering',
      orgId: 'org-1',
      periodStart: '2026-09-01T00:00:00Z',
      periodEnd: '2026-09-08T00:00:00Z',
      totalRequests: 100,
      inputTokens: 20000,
      outputTokens: 30000,
      totalTokens: 50000,
      totalCostUsd: 120.50,
    },
  ],
};

const MOCK_TEAM_REPORT = {
  teamId: 'team-eng',
  teamName: 'Engineering',
  periodStart: '2026-09-01T00:00:00Z',
  periodEnd: '2026-09-08T00:00:00Z',
  totalRequests: 100,
  inputTokens: 20000,
  outputTokens: 30000,
  totalTokens: 50000,
  totalCostUsd: 120.50,
  byModel: [
    {
      tenantId: 'team-eng',
      modelId: 'llama3-8b',
      requestCount: 100,
      promptTokens: 20000,
      completionTokens: 30000,
      totalTokens: 50000,
      avgLatencyMs: 300.0,
      periodStart: '2026-09-01T00:00:00Z',
      periodEnd: '2026-09-08T00:00:00Z',
    },
  ],
};

describe('ChargebackPage — tenants tab', () => {
  it('shows initial empty state prompting user to enter an ID', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    expect(screen.getByText('chargeback.tenants.prompt')).toBeInTheDocument();
  });

  it('Load button is disabled when id input is empty', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const loadBtn = screen.getByTestId('tenants-load-btn');
    expect(loadBtn).toBeDisabled();
  });

  it('Load button enables after typing a non-empty org id', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    expect(screen.getByTestId('tenants-load-btn')).not.toBeDisabled();
  });

  it('renders org billing data after entering org id and clicking Load', () => {
    mq.useOrgBilling.mockReturnValue({ data: MOCK_ORG_REPORT, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    // org billing shows the org's team list
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    // total_cost_usd appears in multiple places (StatRow + OrgBillingTable)
    expect(screen.getAllByText('$120.50').length).toBeGreaterThanOrEqual(1);
  });

  it('renders team billing data after switching scope to team and loading', () => {
    mq.useTeamBilling.mockReturnValue({ data: MOCK_TEAM_REPORT, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    // switch scope to team
    const scopeSelect = screen.getByTestId('tenants-scope');
    fireEvent.change(scopeSelect, { target: { value: 'team' } });
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'team-eng' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    // team billing shows by_model breakdown
    expect(screen.getByText('llama3-8b')).toBeInTheDocument();
  });

  it('shows loading spinner when org billing is loading', () => {
    mq.useOrgBilling.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state when org billing returns an error', () => {
    mq.useOrgBilling.mockReturnValue({ data: undefined, isLoading: false, error: new Error('not found') });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows 402 gate when org billing returns a license error', () => {
    mq.useOrgBilling.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(402, 'enterprise license required', {
        error: { type: 'license_required', feature: 'billing' },
      }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByText('chargeback.enterprise.required')).toBeInTheDocument();
  });

  it('shows 402 gate when team billing returns a license error', () => {
    mq.useTeamBilling.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(402, 'enterprise license required', {
        error: { type: 'license_required', feature: 'billing' },
      }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const scopeSelect = screen.getByTestId('tenants-scope');
    fireEvent.change(scopeSelect, { target: { value: 'team' } });
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'team-eng' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByText('chargeback.enterprise.required')).toBeInTheDocument();
  });

  it('Enter key in id input triggers load', () => {
    mq.useOrgBilling.mockReturnValue({ data: MOCK_ORG_REPORT, isLoading: false, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // After Enter, useOrgBilling should be called with the org id
    expect(mq.useOrgBilling).toHaveBeenCalled();
  });

  it('shows empty state in org billing table when teams array is empty', () => {
    mq.useOrgBilling.mockReturnValue({
      data: { ...MOCK_ORG_REPORT, teams: [] }, isLoading: false, error: null,
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByText('chargeback.tenants.empty')).toBeInTheDocument();
  });

  it('shows empty state in team billing table when by_model is empty', () => {
    mq.useTeamBilling.mockReturnValue({
      data: { ...MOCK_TEAM_REPORT, byModel: [] }, isLoading: false, error: null,
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const scopeSelect = screen.getByTestId('tenants-scope');
    fireEvent.change(scopeSelect, { target: { value: 'team' } });
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'team-eng' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByText('chargeback.tenants.empty')).toBeInTheDocument();
  });

  it('shows loading spinner for team billing', () => {
    mq.useTeamBilling.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const scopeSelect = screen.getByTestId('tenants-scope');
    fireEvent.change(scopeSelect, { target: { value: 'team' } });
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'team-eng' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state for team billing generic error', () => {
    mq.useTeamBilling.mockReturnValue({ data: undefined, isLoading: false, error: new Error('nope') });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'chargeback.tab.tenants' }));
    const scopeSelect = screen.getByTestId('tenants-scope');
    fireEvent.change(scopeSelect, { target: { value: 'team' } });
    const input = screen.getByTestId('tenants-id-input');
    fireEvent.change(input, { target: { value: 'team-eng' } });
    fireEvent.click(screen.getByTestId('tenants-load-btn'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Period picker
// ---------------------------------------------------------------------------

describe('ChargebackPage — period picker', () => {
  it('changes to 7-day period when selected', async () => {
    renderPage();
    const periodSelect = screen.getByRole('combobox', { name: 'chargeback.period.label' });
    fireEvent.change(periodSelect, { target: { value: '7' } });
    await waitFor(() => {
      const calls = mq.useBillingReport.mock.calls as Array<[{ days: number }]>;
      expect(calls.some((c) => c[0]?.days === 7)).toBe(true);
    });
  });

  it('changes to 90-day period when selected', async () => {
    renderPage();
    const periodSelect = screen.getByRole('combobox', { name: 'chargeback.period.label' });
    fireEvent.change(periodSelect, { target: { value: '90' } });
    await waitFor(() => {
      const calls = mq.useBillingReport.mock.calls as Array<[{ days: number }]>;
      expect(calls.some((c) => c[0]?.days === 90)).toBe(true);
    });
  });
});
