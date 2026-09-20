/**
 * AdminAuditLogPage — enterprise admin action trail.
 *
 * Covers:
 *  (c) renders rows from a mocked useAuditLog;
 *  (d) the enterprise-gated path (402 license_required) shows the gated empty
 *      state instead of crashing.
 *
 * Idiom mirrors AuditPage.test.tsx: fully mock ../../hooks/queries, render
 * under the real I18nProvider + MemoryRouter, build the 402 with the real
 * ApiError so isLicenseRequired() detection is exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { ApiError } from '../../api/http';
import type { AuditLog } from '../../api/types';
import type { ReactNode } from 'react';

vi.mock('../../hooks/queries', () => ({
  useAuditLog: vi.fn(),
}));

import { AdminAuditLogPage } from '../AdminAuditLogPage';
import { useAuditLog } from '../../hooks/queries';

const mockUseAuditLog = useAuditLog as unknown as ReturnType<typeof vi.fn>;

const MOCK_LOG: AuditLog = {
  feature: 'audit',
  licensee: 'Acme Corp',
  entries: [
    {
      seq: 2,
      actor: 'admin@acme',
      action: 'apikey.create',
      target: 'key-abc123',
      details: { team: 'eng' },
      prevHash: 'aaa',
      hash: 'bbb',
      createdAt: '2026-09-12T10:00:00Z',
    },
    {
      seq: 1,
      actor: 'admin@acme',
      action: 'login',
      target: 'session',
      prevHash: '000',
      hash: 'aaa',
      createdAt: '2026-09-12T09:00:00Z',
    },
  ],
  chain: { verified: true, length: 2 },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(<AdminAuditLogPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminAuditLogPage', () => {
  it('(c) renders admin audit entries returned by useAuditLog', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('apikey.create')).toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getAllByText('admin@acme').length).toBeGreaterThanOrEqual(2);
  });

  it('(d) shows the enterprise-gated empty state on a 402, not a crash', () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(402, 'enterprise license required', {
        error: { type: 'license_required', feature: 'audit' },
      }),
      refetch: vi.fn(),
    });

    renderPage();

    // The gate renders as a role="status" banner mentioning Enterprise; there
    // must be no crash and no audit rows.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/enterprise feature/i)).toBeInTheDocument();
    expect(screen.queryByText('apikey.create')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading, error, and chain-broken states
// ---------------------------------------------------------------------------

describe('AdminAuditLogPage — loading and error states', () => {
  it('shows LoadingBlock while data is loading', () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state for non-gated generic errors', () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('server error'), isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows enterprise gate for 403 error (forbidden, same as gated)', () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new ApiError(403, 'forbidden', {}),
      isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/enterprise feature/i)).toBeInTheDocument();
  });

  it('shows chain broken badge when chain.verified is false', () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        ...MOCK_LOG,
        chain: { verified: false, length: 2 },
      },
      isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Chain integrity broken')).toBeInTheDocument();
  });

  it('shows chain verified badge when chain.verified is true', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG,
      isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Chain verified')).toBeInTheDocument();
  });

  it('shows licensee when present in response', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG,
      isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Filter behavior
// ---------------------------------------------------------------------------

describe('AdminAuditLogPage — filters', () => {
  it('filters entries by actor', () => {
    const logWithMultipleActors = {
      ...MOCK_LOG,
      entries: [
        ...MOCK_LOG.entries,
        {
          seq: 3, actor: 'other-user@acme', action: 'login', target: 'session',
          prevHash: 'bbb', hash: 'ccc', createdAt: '2026-09-12T11:00:00Z',
        },
      ],
    };
    mockUseAuditLog.mockReturnValue({
      data: logWithMultipleActors, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    const actorInput = screen.getByLabelText('Actor');
    fireEvent.change(actorInput, { target: { value: 'other-user' } });
    // admin@acme entries should be hidden; other-user should be visible
    expect(screen.queryByText('apikey.create')).not.toBeInTheDocument();
    expect(screen.getByText('other-user@acme')).toBeInTheDocument();
  });

  it('filters entries by action', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    const actionInput = screen.getByLabelText('Action');
    fireEvent.change(actionInput, { target: { value: 'login' } });
    // apikey.create action should be filtered out
    expect(screen.queryByText('apikey.create')).not.toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('shows empty state when filter matches nothing', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    const actorInput = screen.getByLabelText('Actor');
    fireEvent.change(actorInput, { target: { value: 'nonexistent-user-xyz' } });
    expect(screen.getByText('No administrative actions recorded yet.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Limit picker and pagination
// ---------------------------------------------------------------------------

describe('AdminAuditLogPage — limit picker and pagination', () => {
  // Build a log with 30 entries to trigger pagination (PAGE_SIZE = 25)
  const BIG_LOG = {
    ...MOCK_LOG,
    chain: { verified: true, length: 30 },
    entries: Array.from({ length: 30 }, (_, i) => ({
      seq: i + 1,
      actor: 'admin@acme',
      action: `action-${i}`,
      target: 'target',
      prevHash: `p${i}`,
      hash: `h${i}`,
      createdAt: '2026-09-12T10:00:00Z',
    })),
  };

  it('next button enables when filtered entries exceed PAGE_SIZE (25)', () => {
    mockUseAuditLog.mockReturnValue({
      data: BIG_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('prev button is disabled on first page', () => {
    mockUseAuditLog.mockReturnValue({
      data: BIG_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('clicking next advances to second page, then prev goes back', () => {
    mockUseAuditLog.mockReturnValue({
      data: BIG_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    // Click next
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Now on page 2: prev button should be enabled
    expect(screen.getByRole('button', { name: 'Prev' })).not.toBeDisabled();
    // Click prev — goes back to page 1
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('changing limit re-calls useAuditLog with new limit', () => {
    mockUseAuditLog.mockReturnValue({
      data: BIG_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    const limitSelect = screen.getByRole('combobox', { name: 'Show' });
    fireEvent.change(limitSelect, { target: { value: '250' } });
    const calls = mockUseAuditLog.mock.calls as Array<[number]>;
    expect(calls.some((c) => c[0] === 250)).toBe(true);
  });

  it('refresh button calls refetch', () => {
    const refetch = vi.fn();
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Row rendering — optional fields
// ---------------------------------------------------------------------------

describe('AdminAuditLogPage — row details rendering', () => {
  it('renders details cell with key=value pairs', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    // MOCK_LOG first entry has details: { team: 'eng' }
    expect(screen.getByText('team=eng')).toBeInTheDocument();
  });

  it('renders "—" placeholder for entry without details', () => {
    mockUseAuditLog.mockReturnValue({
      data: MOCK_LOG, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    // The login entry has no details → DetailsCell renders "—" with opacity: 0.4
    // (via a span with opacity style). The text "—" appears in the table.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders "—" for entry with missing createdAt', () => {
    const entryWithoutDate = {
      seq: 5, actor: 'admin@acme', action: 'logout', target: 'session',
      prevHash: 'ccc', hash: 'ddd', createdAt: '',
    };
    mockUseAuditLog.mockReturnValue({
      data: { ...MOCK_LOG, entries: [entryWithoutDate] },
      isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderPage();
    // createdAt is empty string; new Date('').toLocaleString() would give 'Invalid Date'
    // but the page guards: `entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'`
    // Since '' is falsy, it renders '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
