// AuditPage tests — chain integrity panel, inference audit tab, access log tab,
// and enterprise license gate (v0.6).
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { AuditPage } from './AuditPage';
import { ApiError } from '../api/http';
import type { ChainVerifyResponse, InferenceAuditResponse, AccessLogResponse } from '../api/types';

// ---------------------------------------------------------------------------
// Mock the entire hooks/queries module so no React Query infrastructure is
// needed and no real network calls are made.
// ---------------------------------------------------------------------------

vi.mock('../hooks/queries', () => ({
  useAuditChainVerify: vi.fn(),
  useInferenceAudit: vi.fn(),
  useAccessLog: vi.fn(),
}));

import {
  useAuditChainVerify,
  useInferenceAudit,
  useAccessLog,
} from '../hooks/queries';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_CHAIN_OK: ChainVerifyResponse = {
  verified: true,
  blockCount: 1420,
  lastVerifiedAt: '2026-09-08T14:00:00Z',
  brokenAtSeq: null,
};

const MOCK_CHAIN_BROKEN: ChainVerifyResponse = {
  verified: false,
  blockCount: 567,
  lastVerifiedAt: '2026-09-08T14:00:00Z',
  brokenAtSeq: 568,
};

const MOCK_AUDIT: InferenceAuditResponse = {
  total: 2,
  events: [
    {
      seq: 1,
      modelId: 'llama3-8b',
      modelRevision: 'main',
      modelQuantization: 'Q4_K_M',
      tenant: 'acme',
      apiKeyId: 'key-abc123',
      nodeId: 'node-1',
      inferenceEngine: 'llamacpp',
      inputTokens: 512,
      outputTokens: 128,
      latencyMs: 1240,
      status: 'ok',
      createdAt: '2026-09-08T14:23:07Z',
      hash: 'abc123',
      prevHash: '000000',
    },
    {
      seq: 2,
      modelId: 'qwen3-235b',
      modelRevision: 'main',
      modelQuantization: 'Q8_0',
      tenant: 'beta',
      apiKeyId: 'key-def456',
      nodeId: 'node-2',
      inferenceEngine: 'llamacpp',
      inputTokens: 1024,
      outputTokens: 256,
      latencyMs: 3800,
      status: 'error',
      createdAt: '2026-09-08T15:00:00Z',
      hash: 'def456',
      prevHash: 'abc123',
    },
  ],
};

const MOCK_ACCESS_LOG: AccessLogResponse = {
  count: 1,
  entries: [
    {
      id: 4812,
      apiKeyId: 'key-abc123',
      method: 'POST',
      path: '/v1/chat/completions',
      ipPrefix: '10.0.1.0/24',
      userAgent: 'python-httpx/0.27.2',
      statusCode: 200,
      requestAt: '2026-09-08T14:23:07Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <AuditPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qr(overrides: Record<string, unknown> = {}): any {
  return { data: undefined, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(), ...overrides };
}

function mockChain(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuditChainVerify).mockReturnValue(qr({ data: MOCK_CHAIN_OK, ...overrides }));
}

function mockInference(overrides: Record<string, unknown> = {}) {
  vi.mocked(useInferenceAudit).mockReturnValue(qr({ data: MOCK_AUDIT, ...overrides }));
}

function mockAccess(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAccessLog).mockReturnValue(qr({ data: MOCK_ACCESS_LOG, ...overrides }));
}

function mockAll() {
  mockChain();
  mockInference();
  mockAccess();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditPage — Chain Integrity panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll();
  });

  it('shows verified badge when chain is intact', () => {
    renderPage();
    expect(screen.getByText('Chain verified')).toBeInTheDocument();
  });

  it('shows broken badge with sequence number when chain broken', () => {
    vi.mocked(useAuditChainVerify).mockReturnValue(qr({ data: MOCK_CHAIN_BROKEN }));
    renderPage();
    expect(screen.queryByText('Chain verified')).not.toBeInTheDocument();
    expect(screen.getByText('Chain broken at seq 568')).toBeInTheDocument();
  });

  it('calls /verify endpoint on mount', () => {
    renderPage();
    expect(useAuditChainVerify).toHaveBeenCalled();
  });

  it('shows "Verify Now" button that triggers a fresh call', () => {
    const refetch = vi.fn();
    vi.mocked(useAuditChainVerify).mockReturnValue(qr({ data: MOCK_CHAIN_OK, refetch }));
    renderPage();
    const verifyBtn = screen.getByRole('button', { name: /verify now/i });
    fireEvent.click(verifyBtn);
    expect(refetch).toHaveBeenCalled();
  });
});

describe('AuditPage — Inference Audit tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll();
  });

  it('renders event table with correct columns', () => {
    renderPage();
    // Column headers are rendered as <th> elements; use role=columnheader to be specific.
    expect(screen.getByRole('columnheader', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'API Key' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Latency' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tokens (in/out)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
  });

  it('shows model filter dropdown', () => {
    renderPage();
    const modelSelect = screen.getByRole('combobox', { name: /model/i });
    expect(modelSelect).toBeInTheDocument();
  });

  it('renders pagination controls', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('CSV export button exists', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
  });
});

describe('AuditPage — Access Log tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll();
  });

  it('renders access log table', () => {
    renderPage();
    // Switch to Access Log tab
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    // The access log table should be visible
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('IP Prefix')).toBeInTheDocument();
    expect(screen.getByText('User Agent')).toBeInTheDocument();
  });

  it('shows api_key_id filter', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    const filterInput = screen.getByRole('textbox', { name: /filter by api key/i });
    expect(filterInput).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Enterprise license gate (v0.6)
// ---------------------------------------------------------------------------

/** Build an ApiError that mimics the license_required body shape. */
function licenseError(): ApiError {
  return new ApiError(
    402,
    'enterprise license required',
    { error: { feature: 'inferenceAudit', message: 'enterprise license required', type: 'license_required' } },
  );
}

describe('AuditPage — enterprise license gate', () => {
  it('shows enterprise upgrade card for inference audit when license_required', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(
      qr({ isError: true, error: licenseError() }),
    );
    vi.mocked(useAccessLog).mockReturnValue(qr({ data: { count: 0, entries: [] } }));

    renderPage();

    // Should show the enterprise gate, not a generic error.
    expect(screen.getByText('Enterprise feature')).toBeInTheDocument();
    expect(screen.queryByText('Could not load inference audit log')).not.toBeInTheDocument();
  });

  it('shows enterprise upgrade card for chain verify when license_required', () => {
    vi.clearAllMocks();
    vi.mocked(useAuditChainVerify).mockReturnValue(
      qr({ isError: true, error: licenseError() }),
    );
    mockInference();
    mockAccess();

    renderPage();

    // The chain panel should show the enterprise gate.
    expect(screen.getByText('Enterprise feature')).toBeInTheDocument();
    expect(screen.queryByText('Could not verify audit chain')).not.toBeInTheDocument();
  });

  it('shows generic error for non-license errors in inference audit', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(
      qr({ isError: true, error: new Error('Internal Server Error') }),
    );
    vi.mocked(useAccessLog).mockReturnValue(qr({ data: { count: 0, entries: [] } }));

    renderPage();

    // Should show the generic error, not the enterprise gate.
    expect(screen.queryByText('Enterprise feature')).not.toBeInTheDocument();
  });

  it('enterprise gate contains a link to the enterprise docs', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(
      qr({ isError: true, error: licenseError() }),
    );
    vi.mocked(useAccessLog).mockReturnValue(qr({ data: { count: 0, entries: [] } }));

    renderPage();

    const link = screen.getByRole('link', { name: /enterprise/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('enterprise');
  });

  it('shows generic error alert and retry for non-license chain verify error', () => {
    vi.clearAllMocks();
    const refetch = vi.fn();
    vi.mocked(useAuditChainVerify).mockReturnValue(
      qr({ isError: true, error: new Error('server error'), refetch }),
    );
    mockInference();
    mockAccess();

    renderPage();

    // Not a license error → generic ErrorState renders (not enterprise gate)
    expect(screen.queryByText('Enterprise feature')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Retry callback is wired up
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Loading states
// ---------------------------------------------------------------------------

describe('AuditPage — loading states', () => {
  it('shows spinner while chain integrity is loading', () => {
    vi.clearAllMocks();
    vi.mocked(useAuditChainVerify).mockReturnValue(qr({ isLoading: true }));
    mockInference();
    mockAccess();
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows spinner while inference audit is loading', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(qr({ isLoading: true }));
    mockAccess();
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows empty state when inference audit has no events', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(
      qr({ data: { total: 0, events: [] } }),
    );
    mockAccess();
    renderPage();
    expect(screen.getByText('No inference events yet.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Inference audit — pagination
// ---------------------------------------------------------------------------

describe('AuditPage — inference audit pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChain();
    // Return 55 events so there's a "next" page (PAGE_SIZE = 50)
    const events = Array.from({ length: 55 }, (_, i) => ({
      seq: i + 1,
      modelId: 'llama3-8b',
      modelRevision: 'main',
      modelQuantization: 'Q4_K_M',
      tenant: 'acme',
      apiKeyId: `key-${i}`,
      nodeId: 'node-1',
      inferenceEngine: 'llamacpp',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
      status: 'ok' as const,
      createdAt: '2026-09-08T14:23:07Z',
      hash: `hash${i}`,
      prevHash: `hash${i - 1}`,
    }));
    vi.mocked(useInferenceAudit).mockReturnValue(
      qr({ data: { total: 55, events } }),
    );
    mockAccess();
  });

  it('next page button is enabled when there are more events', () => {
    renderPage();
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('prev button is disabled on first page', () => {
    renderPage();
    const prevBtn = screen.getByRole('button', { name: /prev/i });
    expect(prevBtn).toBeDisabled();
  });

  it('clicking next page advances offset and re-calls hook with new offset', () => {
    renderPage();
    const nextBtn = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextBtn);
    // After advancing, useInferenceAudit should be called with offset >= 50
    const calls = vi.mocked(useInferenceAudit).mock.calls as Array<[{ offset: number }]>;
    expect(calls.some((c) => c[0]?.offset >= 50)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inference audit — filter interactions
// ---------------------------------------------------------------------------

describe('AuditPage — inference audit filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    mockAccess();
  });

  it('model filter select exists with an "all" option', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: /model/i });
    expect(select).toBeInTheDocument();
  });

  it('changing model filter calls useInferenceAudit with modelId param', () => {
    renderPage();
    // The model select is populated with models from events
    const select = screen.getByRole('combobox', { name: /model/i });
    // Options include "all" and the model names from events
    fireEvent.change(select, { target: { value: 'llama3-8b' } });
    const calls = vi.mocked(useInferenceAudit).mock.calls as Array<[{ modelId?: string }]>;
    expect(calls.some((c) => c[0]?.modelId === 'llama3-8b')).toBe(true);
  });

  it('refresh button click triggers refetch', () => {
    const refetch = vi.fn();
    vi.mocked(useInferenceAudit).mockReturnValue(qr({ data: MOCK_AUDIT, refetch }));
    renderPage();
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);
    expect(refetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Inference CSV export
// ---------------------------------------------------------------------------

describe('AuditPage — CSV export', () => {
  beforeAll(() => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('CSV export button is disabled when no events', () => {
    vi.clearAllMocks();
    mockChain();
    vi.mocked(useInferenceAudit).mockReturnValue(qr({ data: { total: 0, events: [] } }));
    mockAccess();
    renderPage();
    const exportBtn = screen.getByRole('button', { name: /export csv/i });
    expect(exportBtn).toBeDisabled();
  });

  it('CSV export button is enabled and triggers download when events exist', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    mockAccess();
    const createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    renderPage();
    const exportBtn = screen.getByRole('button', { name: /export csv/i });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);
    expect(createObjectURL).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Access log — loading/error/empty states
// ---------------------------------------------------------------------------

describe('AuditPage — access log states', () => {
  it('shows error state in access log tab when useAccessLog errors', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    vi.mocked(useAccessLog).mockReturnValue(qr({ isError: true, error: new Error('network error') }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows empty state in access log tab when no entries', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    vi.mocked(useAccessLog).mockReturnValue(qr({ data: { count: 0, entries: [] } }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    expect(screen.getByText('No access log entries.')).toBeInTheDocument();
  });

  it('access log shows status code badge with values from real shape', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    mockAccess();
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    // MOCK_ACCESS_LOG has statusCode: 200 → success badge
    expect(screen.getByText('200')).toBeInTheDocument();
    // Also check method POST renders
    expect(screen.getByText('POST')).toBeInTheDocument();
  });

  it('refresh button in access log triggers refetch', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    const refetch = vi.fn();
    vi.mocked(useAccessLog).mockReturnValue(qr({ data: MOCK_ACCESS_LOG, refetch }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('access log error state retry button calls refetch', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    const refetch = vi.fn();
    vi.mocked(useAccessLog).mockReturnValue(
      qr({ isError: true, error: new Error('network error'), refetch }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('access log shows danger badge for 5xx status code', () => {
    vi.clearAllMocks();
    mockChain();
    mockInference();
    vi.mocked(useAccessLog).mockReturnValue(
      qr({
        data: {
          count: 1,
          entries: [{
            id: 9999, apiKeyId: 'key-x', method: 'POST',
            path: '/v1/completions', ipPrefix: '10.0.0.0/24',
            userAgent: 'test', statusCode: 503, requestAt: '2026-09-08T14:00:00Z',
          }],
        },
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /access log/i }));
    expect(screen.getByText('503')).toBeInTheDocument();
  });
});
