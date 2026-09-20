// ApprovalsPage tests — deployment approval queue (AI Act Art.14).
//
// State machine:
//   loading → error (generic + 402 enterprise gate) → empty → populated
//
// Interactions:
//   filter tabs (all/pending/approved/rejected),
//   approve/reject dialogs (call correct mutation with deploymentId + notes),
//   quorum progress bar (aria-progressbar + correct values),
//   hasVoted guard (Approve button disabled after voting),
//   refresh button.
//
// Uses real i18n translations (I18nProvider) for value assertions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { ApprovalsPage } from './ApprovalsPage';
import { ApiError } from '../api/http';
import type { DeploymentApproval } from '../api/types';

// ---------------------------------------------------------------------------
// Mocked hooks
// ---------------------------------------------------------------------------

vi.mock('../hooks/queries', () => ({
  useApprovals: vi.fn(),
  useApproveDeployment: vi.fn(),
  useRejectDeployment: vi.fn(),
}));

import { useApprovals, useApproveDeployment, useRejectDeployment } from '../hooks/queries';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkApproval(overrides: Partial<DeploymentApproval> = {}): DeploymentApproval {
  return {
    id: 1,
    deploymentId: 'deploy-abc123',
    modelId: 'qwen3-235b',
    requester: 'sha256-abc1234567890',
    requestedAt: '2026-09-10T12:00:00Z',
    status: 'pending',
    reviewer: undefined,
    reviewedAt: undefined,
    notes: undefined,
    quorum: undefined,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qr(overrides: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mut(overrides: Record<string, unknown> = {}): any {
  return {
    mutateAsync: vi.fn(() => Promise.resolve()),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

function mockAll(approvals: DeploymentApproval[] = [], approveMut = mut(), rejectMut = mut()) {
  vi.mocked(useApprovals).mockReturnValue(qr({ data: approvals }));
  vi.mocked(useApproveDeployment).mockReturnValue(approveMut);
  vi.mocked(useRejectDeployment).mockReturnValue(rejectMut);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ApprovalsPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAll([]);
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('ApprovalsPage — loading', () => {
  it('renders no table while loading', () => {
    vi.mocked(useApprovals).mockReturnValue(qr({ isLoading: true }));
    const { container } = renderPage();
    expect(container.querySelector('table')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('ApprovalsPage — error', () => {
  it('shows error alert for generic errors', () => {
    vi.mocked(useApprovals).mockReturnValue(
      qr({ isError: true, error: new Error('Network failed') }),
    );
    renderPage();
    expect(screen.getByRole('alert')).toBeDefined();
    // Must NOT show enterprise gate
    expect(screen.queryByText(/Enterprise license required/i)).toBeNull();
  });

  it('shows enterprise license gate for 402 response', () => {
    vi.mocked(useApprovals).mockReturnValue(
      qr({ isError: true, error: new ApiError(402, 'Payment Required', {}) }),
    );
    renderPage();
    // The enterprise gate uses EmptyState — looks for the license text
    expect(screen.getByText('Enterprise license required for deployment approvals')).toBeDefined();
  });

  it('enterprise gate shows a link to docs', () => {
    vi.mocked(useApprovals).mockReturnValue(
      qr({ isError: true, error: new ApiError(402, 'Payment Required', {}) }),
    );
    renderPage();
    const link = screen.getByRole('link', { name: /deployment approvals/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toContain('purser.dev');
  });

  it('does not show enterprise gate for non-402 errors', () => {
    vi.mocked(useApprovals).mockReturnValue(
      qr({ isError: true, error: new ApiError(500, 'Internal Server Error', {}) }),
    );
    renderPage();
    expect(screen.queryByText('Enterprise license required for deployment approvals')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('ApprovalsPage — empty', () => {
  it('renders empty state when there are no approvals', () => {
    mockAll([]);
    renderPage();
    expect(screen.getByText('No approval requests yet.')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Populated state
// ---------------------------------------------------------------------------

describe('ApprovalsPage — populated', () => {
  it('renders approval rows with model id, requester, and status badge', () => {
    mockAll([
      mkApproval({ modelId: 'qwen3-235b', requester: 'abc12345678901', status: 'pending' }),
    ]);
    renderPage();
    expect(screen.getByText('qwen3-235b')).toBeDefined();
    // Requester is truncated to 12 chars + ellipsis
    expect(screen.getByText('abc123456789…')).toBeDefined();
    // Status badge specifically (badge span, not the filter button)
    const badges = screen.getAllByText('Pending');
    // At least one is a badge span (the other may be the filter button)
    expect(badges.length).toBeGreaterThanOrEqual(1);
    const badge = badges.find((el) => el.tagName === 'SPAN' && el.classList.contains('badge'));
    expect(badge).toBeDefined();
  });

  it('renders approved and rejected rows with correct badges', () => {
    mockAll([
      mkApproval({ id: 1, deploymentId: 'd1', status: 'approved' }),
      mkApproval({ id: 2, deploymentId: 'd2', status: 'rejected' }),
    ]);
    renderPage();
    // Use getAllByText to handle any potential duplicates (filter buttons vs badges)
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('shows reviewer hash when reviewer is set', () => {
    mockAll([
      mkApproval({ status: 'approved', reviewer: 'reviewer-abc1234567890' }),
    ]);
    renderPage();
    // reviewer is truncated to 12 chars + ellipsis
    expect(screen.getByText('reviewer-abc…')).toBeDefined();
  });

  it('renders notes when set', () => {
    mockAll([
      mkApproval({ status: 'approved', notes: 'LGTM, approved' }),
    ]);
    renderPage();
    expect(screen.getByText('LGTM, approved')).toBeDefined();
  });

  it('renders Approve and Reject buttons for pending approvals', () => {
    mockAll([mkApproval({ status: 'pending' })]);
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined();
  });

  it('does not render action buttons for approved rows', () => {
    mockAll([mkApproval({ status: 'approved' })]);
    renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('renders column headers', () => {
    mockAll([mkApproval()]);
    renderPage();
    expect(screen.getByText('Model')).toBeDefined();
    expect(screen.getByText('Requester')).toBeDefined();
    expect(screen.getByText('Requested')).toBeDefined();
    expect(screen.getByText('Status')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Quorum progress bar
// ---------------------------------------------------------------------------

describe('ApprovalsPage — quorum progress bar', () => {
  it('renders quorum progress bar for pending approvals with quorum data', () => {
    mockAll([
      mkApproval({
        status: 'pending',
        quorum: { received: 1, required: 2, remaining: 1 },
      }),
    ]);
    renderPage();
    const pb = screen.getByRole('progressbar');
    expect(pb).toBeDefined();
    expect(pb.getAttribute('aria-valuenow')).toBe('1');
    expect(pb.getAttribute('aria-valuemax')).toBe('2');
  });

  it('does not render quorum bar when quorum data is absent', () => {
    mockAll([mkApproval({ status: 'pending', quorum: undefined })]);
    renderPage();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not render quorum bar for non-pending approvals', () => {
    mockAll([
      mkApproval({ status: 'approved', quorum: { received: 2, required: 2, remaining: 0 } }),
    ]);
    renderPage();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('computes 100% when received equals required', () => {
    mockAll([
      mkApproval({
        status: 'pending',
        quorum: { received: 2, required: 2, remaining: 0 },
      }),
    ]);
    renderPage();
    const pb = screen.getByRole('progressbar');
    expect(pb.getAttribute('aria-valuenow')).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Approve action dialog
// ---------------------------------------------------------------------------

describe('ApprovalsPage — approve action', () => {
  it('opens approve dialog with notes textarea when Approve is clicked', () => {
    mockAll([mkApproval({ status: 'pending' })]);
    renderPage();
    // Click the first Approve button (from the row)
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);
    // Notes textarea should be visible inside the dialog
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('calls approveDeployment with deploymentId and optional notes', async () => {
    const mutateAsync = vi.fn(() => Promise.resolve());
    vi.mocked(useApproveDeployment).mockReturnValue(mut({ mutateAsync }));
    vi.mocked(useRejectDeployment).mockReturnValue(mut());
    vi.mocked(useApprovals).mockReturnValue(qr({ data: [mkApproval({ deploymentId: 'deploy-approve-1', status: 'pending' })] }));
    renderPage();

    // Open dialog by clicking the row's Approve button
    const approveBtnsInitial = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtnsInitial[0]);

    // Add notes in dialog textarea (now visible after dialog opens)
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Looks good' } });

    // The dialog renders AFTER the row in the DOM; the last Approve button is in the dialog
    const allApproveBtns = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(allApproveBtns[allApproveBtns.length - 1]);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ deploymentId: 'deploy-approve-1', notes: 'Looks good' }),
      );
    });
  });

  it('closes approve dialog when Cancel is clicked', () => {
    mockAll([mkApproval({ status: 'pending' })]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('textbox')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reject action dialog
// ---------------------------------------------------------------------------

describe('ApprovalsPage — reject action', () => {
  it('calls rejectDeployment with deploymentId when Reject is confirmed', async () => {
    const mutateAsync = vi.fn(() => Promise.resolve());
    vi.mocked(useApproveDeployment).mockReturnValue(mut());
    vi.mocked(useRejectDeployment).mockReturnValue(mut({ mutateAsync }));
    vi.mocked(useApprovals).mockReturnValue(qr({ data: [mkApproval({ deploymentId: 'deploy-reject-1', status: 'pending' })] }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    // The reject button inside the dialog
    const rejectBtns = screen.getAllByRole('button', { name: 'Reject' });
    fireEvent.click(rejectBtns[rejectBtns.length - 1]);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ deploymentId: 'deploy-reject-1' }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// hasVoted guard — Approve disabled after voting
// ---------------------------------------------------------------------------

describe('ApprovalsPage — hasVoted guard', () => {
  it('Approve button is disabled when quorum.remaining is 0', () => {
    mockAll([
      mkApproval({
        status: 'pending',
        quorum: { received: 2, required: 2, remaining: 0 },
      }),
    ]);
    renderPage();
    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    expect(approveBtn).toBeDisabled();
  });

  it('Approve button is enabled when quorum.remaining is > 0', () => {
    mockAll([
      mkApproval({
        status: 'pending',
        quorum: { received: 1, required: 2, remaining: 1 },
      }),
    ]);
    renderPage();
    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    expect(approveBtn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

describe('ApprovalsPage — filter tabs', () => {
  it('renders filter tabs for All, Pending, Approved, Rejected', () => {
    mockAll([]);
    renderPage();
    expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approved' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rejected' })).toBeDefined();
  });

  it('calls useApprovals with status filter when a filter tab is clicked', () => {
    mockAll([]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    // useApprovals should be called with 'pending' as first arg (second arg is limit default in hook)
    const calls = vi.mocked(useApprovals).mock.calls;
    const pendingCall = calls.find((c) => c[0] === 'pending');
    expect(pendingCall).toBeDefined();
  });

  it('calls useApprovals with undefined status when All tab is selected', () => {
    mockAll([]);
    renderPage();
    // Click Pending then All to verify behavior
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    // The last call should have undefined status (All = no filter, '' || undefined)
    const calls = vi.mocked(useApprovals).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Refresh button
// ---------------------------------------------------------------------------

describe('ApprovalsPage — refresh', () => {
  it('renders a refresh button', () => {
    mockAll([]);
    renderPage();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDefined();
  });
});
