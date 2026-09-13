// ---------------------------------------------------------------------------
// JoinTokenPage tests
//
// Covers: token display, expiry, rotate button, TTL selector, download button.
// Mocks: useJoinInfo, useRotateToken from hooks/queries.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinTokenPage } from './JoinTokenPage';
import type { JoinInfo } from '../api/types';

// ---------------------------------------------------------------------------
// Mock i18n
// ---------------------------------------------------------------------------
vi.mock('../i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Mock hooks/queries
// ---------------------------------------------------------------------------
vi.mock('../hooks/queries', () => ({
  useJoinInfo: vi.fn(),
  useRotateToken: vi.fn(),
}));

import { useJoinInfo, useRotateToken } from '../hooks/queries';
const mockUseJoinInfo = vi.mocked(useJoinInfo);
const mockUseRotateToken = vi.mocked(useRotateToken);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const joinInfo: JoinInfo = {
  joinToken: 'pjt-abc123-xyz789',
  controlPlaneUrl: 'https://cp.example.com',
  expiresAt: new Date(Date.now() + 3600 * 1000 * 24).toISOString(), // +24h
};

const expiredJoinInfo: JoinInfo = {
  joinToken: 'pjt-expired-token',
  controlPlaneUrl: 'https://cp.example.com',
  expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(), // -1h (expired)
};

function success<T>(data: T) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

function renderPage() {
  return render(<JoinTokenPage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JoinTokenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRotateToken.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      data: undefined,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useRotateToken>);
  });

  // --- Page title -------------------------------------------------------

  it('renders the page title', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('join.title')).toBeInTheDocument();
  });

  // --- Loading / error states ------------------------------------------

  it('shows loading block while join info loads', () => {
    mockUseJoinInfo.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useJoinInfo>);
    expect(() => renderPage()).not.toThrow();
  });

  it('shows error state with retry when join info fails', () => {
    const refetch = vi.fn();
    mockUseJoinInfo.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('Network error'), refetch,
    } as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // --- Token display ----------------------------------------------------

  it('renders the join token value', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('pjt-abc123-xyz789')).toBeInTheDocument();
  });

  it('shows expiry notice for a valid (non-expired) token', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText(/onboarding\.token\.expires/)).toBeInTheDocument();
  });

  it('shows expired notice for expired token', () => {
    mockUseJoinInfo.mockReturnValue(success(expiredJoinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('onboarding.token.expired')).toBeInTheDocument();
  });

  it('expired token section has danger modifier class', () => {
    mockUseJoinInfo.mockReturnValue(success(expiredJoinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const expiryEl = screen.getByText('onboarding.token.expired').closest('.token-expiry');
    expect(expiryEl).toHaveClass('token-expiry--danger');
  });

  // --- Rotate token -----------------------------------------------------

  it('calls rotate mutate when rotate button is clicked', async () => {
    const user = userEvent.setup();
    const rotateMutate = vi.fn();
    mockUseRotateToken.mockReturnValue({
      mutate: rotateMutate,
      isPending: false,
      isError: false,
      isSuccess: false,
      data: undefined,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useRotateToken>);
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const rotateBtn = screen.getByRole('button', { name: /onboarding\.token\.rotate/i });
    await user.click(rotateBtn);
    expect(rotateMutate).toHaveBeenCalledTimes(1);
  });

  it('disables rotate button while rotation is pending', () => {
    mockUseRotateToken.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      isSuccess: false,
      data: undefined,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useRotateToken>);
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const rotateBtn = screen.getByRole('button', { name: /onboarding\.token\.rotate/i });
    expect(rotateBtn).toBeDisabled();
  });

  // --- Enrollment bundle ------------------------------------------------

  it('renders TTL select with all 4 options', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const select = document.getElementById('bundle-ttl') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('3600');
    expect(values).toContain('86400');
    expect(values).toContain('604800');
    expect(values).toContain('2592000');
  });

  it('download button starts enabled (not loading)', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const downloadBtn = screen.getByRole('button', { name: /join\.bundle\.download/i });
    expect(downloadBtn).not.toBeDisabled();
  });

  it('TTL select changes value when option selected', async () => {
    const user = userEvent.setup();
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    const select = document.getElementById('bundle-ttl') as HTMLSelectElement;
    await user.selectOptions(select, '604800');
    expect(select.value).toBe('604800');
  });
});
