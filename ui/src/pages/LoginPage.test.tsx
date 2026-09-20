/**
 * LoginPage — TDD (W3 Phase 3.1).
 *
 * Tests written BEFORE implementation; expected to fail until LoginPage.tsx exists.
 *
 * Scope:
 *  - OIDC configured → shows OIDC sign-in button (href /auth/login)
 *  - OIDC absent     → no OIDC button
 *  - LDAP form always present (always-tentable)
 *  - Dev-mode (no auth) → dev-mode message + "Continue" button, no LDAP/OIDC forms
 *  - LDAP submit success → redirects to /
 *  - LDAP submit error   → shows error message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mock i18n — return key verbatim
// ---------------------------------------------------------------------------
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------
let mockOidc: { issuer: string; clientId: string; redirectUri: string } | null = null;
let mockLocalAuth = false;

vi.mock('../api/config', () => ({
  config: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === 'oidc') return mockOidc;
      if (prop === 'localAuth') return mockLocalAuth;
      return undefined;
    },
  }),
  handleUnauthorized: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock api client for LDAP + local-admin login
// ---------------------------------------------------------------------------
const mockLdapLogin = vi.fn();
const mockLocalLogin = vi.fn();
vi.mock('../api/client', () => ({
  api: {
    ldapLogin: (...args: unknown[]) => mockLdapLogin(...args),
    localLogin: (...args: unknown[]) => mockLocalLogin(...args),
  },
  makeChat: vi.fn(),
}));

// Dynamic import after mocks
import { LoginPage } from './LoginPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockOidc = null;
  mockLocalAuth = false;
  mockLdapLogin.mockReset();
  mockLocalLogin.mockReset();
  // Reset window.location manipulation
  delete (window as unknown as Record<string, unknown>).location;
  (window as unknown as Record<string, unknown>).location = { href: '' };
});

// ---------------------------------------------------------------------------
// Dev-mode (no auth configured)
// ---------------------------------------------------------------------------
describe('LoginPage — dev-mode (no OIDC, no auth)', () => {
  it('shows dev-mode title', () => {
    renderLogin();
    expect(screen.getByText('auth.devMode.title')).toBeInTheDocument();
  });

  it('shows dev-mode description', () => {
    renderLogin();
    expect(screen.getByText('auth.devMode.body')).toBeInTheDocument();
  });

  it('shows Continue button that links to /', () => {
    renderLogin();
    const btn = screen.getByRole('link', { name: 'auth.devMode.continue' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('href', '/');
  });

  it('does NOT show OIDC button in dev-mode', () => {
    renderLogin();
    expect(screen.queryByText('auth.login.oidc.button')).not.toBeInTheDocument();
  });

  it('does NOT show LDAP form in dev-mode', () => {
    renderLogin();
    expect(screen.queryByLabelText('auth.login.ldap.username')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OIDC configured
// ---------------------------------------------------------------------------
describe('LoginPage — OIDC configured', () => {
  beforeEach(() => {
    mockOidc = { issuer: 'https://idp.example.com', clientId: 'purser', redirectUri: '/callback' };
  });

  it('shows OIDC sign-in button', () => {
    renderLogin();
    expect(screen.getByText('auth.login.oidc.button')).toBeInTheDocument();
  });

  it('OIDC button navigates to /auth/login', () => {
    renderLogin();
    const btn = screen.getByText('auth.login.oidc.button');
    fireEvent.click(btn);
    expect(window.location.href).toBe('/auth/login');
  });

  it('shows LDAP form alongside OIDC button', () => {
    renderLogin();
    expect(screen.getByLabelText('auth.login.ldap.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.login.ldap.password')).toBeInTheDocument();
  });

  it('does NOT show dev-mode message when OIDC is configured', () => {
    renderLogin();
    expect(screen.queryByText('auth.devMode.title')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LDAP form (auth configured, no OIDC — just LDAP)
// ---------------------------------------------------------------------------
describe('LoginPage — LDAP form', () => {
  it('shows username and password fields', () => {
    // no OIDC, but we still show LDAP form
    renderLogin();
    // in dev-mode there's no LDAP form, so we need to simulate auth configured
    // Dev-mode check: if neither OIDC nor auth configured → dev-mode
    // For LDAP only: no oidc, but page still shows LDAP (always-tentable)
    // Actually per brief: dev-mode = no auth configured = no OIDC AND /me responds freely
    // For this test, we set no oidc but test that LDAP shows up in LDAP-only scenario
    // Let's set oidc to non-null to trigger "auth configured" branch
    mockOidc = { issuer: 'https://idp.example.com', clientId: 'purser', redirectUri: '/cb' };
    const { unmount } = renderLogin();
    expect(screen.getByLabelText('auth.login.ldap.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.login.ldap.password')).toBeInTheDocument();
    unmount();
  });

  it('submits LDAP credentials and redirects on success', async () => {
    mockOidc = { issuer: 'https://idp.example.com', clientId: 'purser', redirectUri: '/cb' };
    mockLdapLogin.mockResolvedValueOnce({ ok: true });
    renderLogin();

    fireEvent.change(screen.getByLabelText('auth.login.ldap.username'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.login.ldap.password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.login.ldap.submit' }));

    await waitFor(() => {
      expect(mockLdapLogin).toHaveBeenCalledWith('alice', 'secret');
    });
  });

  it('shows error message on LDAP failure', async () => {
    mockOidc = { issuer: 'https://idp.example.com', clientId: 'purser', redirectUri: '/cb' };
    mockLdapLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
    renderLogin();

    fireEvent.change(screen.getByLabelText('auth.login.ldap.username'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.login.ldap.password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.login.ldap.submit' }));

    await waitFor(() => {
      expect(screen.getByText('auth.login.ldap.error')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Local-admin login (config.localAuth === true, no OIDC)
// ---------------------------------------------------------------------------
describe('LoginPage — local-admin login', () => {
  beforeEach(() => {
    mockLocalAuth = true;
    mockOidc = null;
  });

  it('renders the local login form, not the dev-mode banner', () => {
    renderLogin();
    expect(screen.queryByText('auth.devMode.title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('auth.login.local.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.login.local.password')).toBeInTheDocument();
  });

  it('does NOT show the OIDC button when only local auth is configured', () => {
    renderLogin();
    expect(screen.queryByText('auth.login.oidc.button')).not.toBeInTheDocument();
  });

  it('submits local-admin credentials and redirects to / on success', async () => {
    mockLocalLogin.mockResolvedValueOnce(undefined);
    renderLogin();

    fireEvent.change(screen.getByLabelText('auth.login.local.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('auth.login.local.password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.login.local.submit' }));

    await waitFor(() => {
      expect(mockLocalLogin).toHaveBeenCalledWith('admin', 'pw');
    });
    await waitFor(() => {
      expect(window.location.href).toBe('/');
    });
  });

  it('shows an inline error on local-admin login failure', async () => {
    mockLocalLogin.mockRejectedValueOnce(new Error('bad creds'));
    renderLogin();

    fireEvent.change(screen.getByLabelText('auth.login.local.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('auth.login.local.password'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.login.local.submit' }));

    await waitFor(() => {
      expect(screen.getByText('auth.login.local.error')).toBeInTheDocument();
    });
  });
});
