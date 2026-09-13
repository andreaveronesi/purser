// ---------------------------------------------------------------------------
// OnboardingPage tests
//
// The OnboardingPage shows a join token with OS-specific install commands,
// a rotate button, and the enrollment flow explanation card.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingPage } from './OnboardingPage';
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
  return render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingPage', () => {
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

  // --- Loading / error states -------------------------------------------------

  it('renders the page header title', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('onboarding.title')).toBeInTheDocument();
  });

  it('shows loading block while join info loads', () => {
    mockUseJoinInfo.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useJoinInfo>);

    // Should not crash
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

  // --- Token display ----------------------------------------------------------

  it('renders the join token value', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('pjt-abc123-xyz789')).toBeInTheDocument();
  });

  it('shows expiry notice for valid token', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    // expiry text uses onboarding.token.expires key
    expect(screen.getByText(/onboarding\.token\.expires/)).toBeInTheDocument();
  });

  it('shows expired notice for expired token', () => {
    mockUseJoinInfo.mockReturnValue(success(expiredJoinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();
    expect(screen.getByText('onboarding.token.expired')).toBeInTheDocument();
  });

  it('expired token section has danger class', () => {
    mockUseJoinInfo.mockReturnValue(success(expiredJoinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    // The expiry element should have the danger modifier class
    const expiryEl = screen.getByText('onboarding.token.expired').closest('.token-expiry');
    expect(expiryEl).toHaveClass('token-expiry--danger');
  });

  // --- Rotate token -----------------------------------------------------------

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

  // --- OS tab switching -------------------------------------------------------

  it('renders all OS tabs', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    expect(screen.getByText('onboarding.os.linux')).toBeInTheDocument();
    expect(screen.getByText('onboarding.os.windows')).toBeInTheDocument();
    expect(screen.getByText('onboarding.os.docker')).toBeInTheDocument();
    expect(screen.getByText('onboarding.os.ansible')).toBeInTheDocument();
  });

  it('shows linux command (containing control-plane URL) by default', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    // Linux snippet includes the controlPlaneUrl
    expect(screen.getByText(/https:\/\/cp\.example\.com/)).toBeInTheDocument();
    // And the join token
    expect(screen.getAllByText(/pjt-abc123-xyz789/).length).toBeGreaterThan(0);
  });

  it('shows docker command after clicking Docker tab', async () => {
    const user = userEvent.setup();
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    await user.click(screen.getByText('onboarding.os.docker'));

    // Docker snippet contains 'docker run'
    await waitFor(() => {
      expect(screen.getByText(/docker run/)).toBeInTheDocument();
    });
  });

  it('shows windows command after clicking Windows tab', async () => {
    const user = userEvent.setup();
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    await user.click(screen.getByText('onboarding.os.windows'));

    await waitFor(() => {
      expect(screen.getByText(/Install-PurserAgent/)).toBeInTheDocument();
    });
  });

  it('shows ansible command after clicking Ansible tab', async () => {
    const user = userEvent.setup();
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    await user.click(screen.getByText('onboarding.os.ansible'));

    await waitFor(() => {
      expect(screen.getByText(/ansible-playbook/)).toBeInTheDocument();
    });
  });

  // --- Onboarding steps -------------------------------------------------------

  it('renders 4 onboarding steps', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    const stepsContainer = screen.getByRole('list', { name: /onboarding steps/i });
    const steps = stepsContainer.querySelectorAll('li');
    expect(steps.length).toBe(4);
  });

  it('shows enrollment flow with control plane node', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    expect(screen.getByText('Control plane')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('shows "Go to Fleet" link pointing to /fleet', () => {
    mockUseJoinInfo.mockReturnValue(success(joinInfo) as unknown as ReturnType<typeof useJoinInfo>);
    renderPage();

    const fleetLink = screen.getByRole('link', { name: /onboarding\.goToFleet/i });
    expect(fleetLink).toHaveAttribute('href', '/fleet');
  });
});
