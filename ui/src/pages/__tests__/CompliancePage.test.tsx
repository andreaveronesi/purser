/**
 * CompliancePage — AI Act / GDPR compliance surface.
 *
 * Covers:
 *  (a) the page renders and the two regulatory-export buttons call the right
 *      API client methods (getAiActTechnicalDoc / getGdprRecordOfProcessing);
 *  (b) the GDPR erasure form submits the entered subject identifier via the
 *      erasure mutation and renders a confirmation;
 *  (c) the erasure-log read-only view renders its empty state gracefully.
 *
 * Idiom mirrors AuditPage/ChargebackPage tests: mock ../../hooks/queries and
 * ../../api/client, render under the real I18nProvider + MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import type { ReactNode } from 'react';

// --- api client: the compliance downloads call these directly ----------------
vi.mock('../../api/client', () => ({
  api: {
    getAiActTechnicalDoc: vi.fn(async () => '{"system_name":"Purser AI Inference Gateway"}'),
    getGdprRecordOfProcessing: vi.fn(async () => '{"controller":"Acme Corp"}'),
  },
}));

// --- hooks: erasure mutation + erasure-log query -----------------------------
const { erasureMutate } = vi.hoisted(() => ({ erasureMutate: vi.fn() }));

vi.mock('../../hooks/queries', () => ({
  useGdprErasure: vi.fn(),
  useGdprErasureLog: vi.fn(),
}));

import { CompliancePage } from '../CompliancePage';
import { api } from '../../api/client';
import { ApiError } from '../../api/http';
import { useGdprErasure, useGdprErasureLog } from '../../hooks/queries';

const mockErasure = useGdprErasure as unknown as ReturnType<typeof vi.fn>;
const mockErasureLog = useGdprErasureLog as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(<CompliancePage />, { wrapper });
}

beforeAll(() => {
  // jsdom implements neither URL.createObjectURL nor the anchor navigation the
  // blob download relies on; stub both so the download handler cannot throw.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockErasure.mockReturnValue({
    mutate: erasureMutate,
    isPending: false,
    isError: false,
    error: null,
  });
  mockErasureLog.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('CompliancePage', () => {
  it('(a) renders and the two export buttons call the right client methods', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AI Act/i }));
    await waitFor(() => expect(api.getAiActTechnicalDoc).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /record of processing/i }));
    await waitFor(() => expect(api.getGdprRecordOfProcessing).toHaveBeenCalledTimes(1));
  });

  it('(b) erasure form submits the entered subject id and shows a confirmation', () => {
    const result = {
      erasedEvents: 3,
      erasureType: 'inference_audit',
      completedAt: '2026-09-12T00:00:00Z',
      subjectPrefix: 'a1b2c3d4...',
    };
    // Make mutate invoke its onSuccess so the confirmation renders in one step.
    mockErasure.mockReturnValue({
      mutate: (vars: unknown, opts?: { onSuccess?: (r: typeof result) => void }) => {
        erasureMutate(vars);
        opts?.onSuccess?.(result);
      },
      isPending: false,
      isError: false,
      error: null,
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/subject identifier/i), {
      target: { value: 'a1b2c3d4e5f6' },
    });
    fireEvent.click(screen.getByRole('button', { name: /erase records/i }));

    expect(erasureMutate).toHaveBeenCalledTimes(1);
    expect(erasureMutate).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'api_key', subjectIdentifier: 'a1b2c3d4e5f6' }),
    );

    const confirmation = screen.getByTestId('erasure-confirmation');
    expect(confirmation).toBeInTheDocument();
    expect(within(confirmation).getByText(/3/)).toBeInTheDocument();
  });

  it('(c) renders the erasure-log empty state without crashing', () => {
    renderPage();
    expect(screen.getByText(/no erasure operations/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ErasureCard — extra states
// ---------------------------------------------------------------------------

describe('CompliancePage — ErasureCard states', () => {
  it('submit button is disabled when subject input is empty', () => {
    renderPage();
    const submitBtn = screen.getByRole('button', { name: /erase records/i });
    expect(submitBtn).toBeDisabled();
  });

  it('shows pending label while erasure is in progress', () => {
    mockErasure.mockReturnValue({ mutate: erasureMutate, isPending: true, isError: false, error: null });
    renderPage();
    expect(screen.getByRole('button', { name: /erasing/i })).toBeInTheDocument();
  });

  it('shows forbidden error message on 403', () => {
    mockErasure.mockReturnValue({
      mutate: erasureMutate,
      isPending: false,
      isError: true,
      error: new ApiError(403, 'forbidden', {}),
    });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Admin role required — this operation is restricted to administrators.')).toBeInTheDocument();
  });

  it('shows generic erasure error for non-license non-403 errors', () => {
    mockErasure.mockReturnValue({
      mutate: erasureMutate,
      isPending: false,
      isError: true,
      error: new Error('internal server error'),
    });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Could not complete the erasure. Retry in a moment.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ErasureLogCard — entries rendering
// ---------------------------------------------------------------------------

import type { GdprErasureLogEntry } from '../../api/types';

const MOCK_ERASURE_LOG: GdprErasureLogEntry[] = [
  {
    id: 1,
    subjectHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    erasedAt: '2026-09-10T12:00:00Z',
    erasedBy: 'admin@acme',
    reason: 'GDPR request',
    eventsErased: 42,
    erasureType: 'inference_audit',
  },
  {
    id: 2,
    subjectHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    erasedAt: '',
    erasedBy: 'admin@acme',
    reason: '',
    eventsErased: 0,
    erasureType: 'inference_audit',
  },
];

describe('CompliancePage — ErasureLogCard with entries', () => {
  it('renders erasure log entries with truncated subject hash and events count', () => {
    mockErasureLog.mockReturnValue({
      data: MOCK_ERASURE_LOG, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    // First entry: subjectHash.slice(0, 12)… = "a1b2c3d4e5f6…"
    expect(screen.getByText('a1b2c3d4e5f6…')).toBeInTheDocument();
    // eventsErased = 42
    expect(screen.getByText('42')).toBeInTheDocument();
    // erasedBy
    expect(screen.getAllByText('admin@acme').length).toBeGreaterThan(0);
    // reason "GDPR request"
    expect(screen.getByText('GDPR request')).toBeInTheDocument();
  });

  it('renders "—" for entry with empty erasedAt', () => {
    mockErasureLog.mockReturnValue({
      data: MOCK_ERASURE_LOG, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    // Second entry has erasedAt = '' which is falsy → renders '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows loading spinner in erasure log', () => {
    mockErasureLog.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows enterprise gate in erasure log for license_required error', () => {
    // Use real ApiError so isLicenseRequired() instanceof check passes.
    const err = new ApiError(402, 'enterprise license required', {
      error: { type: 'license_required', feature: 'compliance' },
    });
    mockErasureLog.mockReturnValue({
      data: undefined, isLoading: false, isError: true, error: err, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Enterprise feature')).toBeInTheDocument();
  });

  it('shows error state in erasure log for generic error with retry', () => {
    const refetch = vi.fn();
    mockErasureLog.mockReturnValue({
      data: undefined, isLoading: false, isError: true, error: new Error('network'), refetch,
    });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ExportsCard — error states
// ---------------------------------------------------------------------------

describe('CompliancePage — ExportsCard error states', () => {
  it('shows error state when AI Act export fails with a non-license error', async () => {
    const { api: mockApi } = await import('../../api/client');
    (mockApi.getAiActTechnicalDoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network error'),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /AI Act/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
