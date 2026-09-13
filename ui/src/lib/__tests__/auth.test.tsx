/**
 * AuthContext / useAuth — TDD (W3 Phase 3.1).
 *
 * Tests are written BEFORE the implementation; they are expected to fail
 * until lib/auth.tsx is created.
 *
 * Scope:
 *  - AuthProvider populates user/isAuthenticated from useMe()
 *  - When /me returns a user → isAuthenticated = true, user populated
 *  - When /me returns 401 (isError=true) + auth is configured → isAuthenticated = false
 *  - Dev-mode detection: no OIDC → isDevMode = true, isAuthenticated = true (regardless of /me)
 *  - Default context (no Provider) → dev-mode (isAuthenticated=true, isDevMode=true)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CurrentUser } from '../../api/types';

// ---------------------------------------------------------------------------
// Mock config — controls OIDC/auth state
// ---------------------------------------------------------------------------

let mockOidc: { issuer: string; clientId: string; redirectUri: string } | null = null;

vi.mock('../../api/config', () => ({
  config: new Proxy({} as { oidc: typeof mockOidc; mock: boolean; apiBase: string; gatewayBase: string }, {
    get: (_t, prop) => {
      if (prop === 'oidc') return mockOidc;
      if (prop === 'mock') return false;
      if (prop === 'apiBase') return '/api/v1';
      if (prop === 'gatewayBase') return '/v1';
      return undefined;
    },
  }),
  handleUnauthorized: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock useMe (the query the AuthProvider calls)
// ---------------------------------------------------------------------------

let mockMeResult: {
  data: CurrentUser | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock('../../hooks/queries', () => ({
  useMe: () => mockMeResult,
}));

// Dynamic import after mocks are hoisted
import { AuthProvider, useAuth } from '../auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER: CurrentUser = {
  actor: 'alice',
  email: 'alice@example.com',
  role: 'platform_admin',
  isPlatformAdmin: true,
  isOrgAdmin: false,
  orgs: [],
  teams: [],
};

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQc()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockOidc = null;
  mockMeResult = { data: undefined, isLoading: false, isError: false };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuth — default context (no Provider)', () => {
  it('returns dev-mode defaults when no AuthProvider is present', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isDevMode).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

describe('AuthProvider — dev-mode (no OIDC configured)', () => {
  it('isDevMode = true when config.oidc is null', () => {
    mockOidc = null;
    mockMeResult = { data: MOCK_USER, isLoading: false, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isDevMode).toBe(true);
  });

  it('isAuthenticated = true in dev-mode even without a user', () => {
    mockOidc = null;
    mockMeResult = { data: undefined, isLoading: false, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('isLoading = false in dev-mode (no waiting for /me)', () => {
    mockOidc = null;
    mockMeResult = { data: undefined, isLoading: true, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    // dev-mode skips the loading wait — always ready
    expect(result.current.isLoading).toBe(false);
  });
});

describe('AuthProvider — auth configured (OIDC present)', () => {
  beforeEach(() => {
    mockOidc = { issuer: 'https://idp.example.com', clientId: 'purser-ui', redirectUri: 'https://purser.example.com/auth/callback' };
  });

  it('isDevMode = false when OIDC is configured', () => {
    mockMeResult = { data: MOCK_USER, isLoading: false, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isDevMode).toBe(false);
  });

  it('isAuthenticated = true and user populated when /me returns a user', () => {
    mockMeResult = { data: MOCK_USER, isLoading: false, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(MOCK_USER);
  });

  it('isAuthenticated = false and user null when /me returns 401 (isError=true)', () => {
    mockMeResult = { data: undefined, isLoading: false, isError: true };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('isLoading = true while /me is in flight', () => {
    mockMeResult = { data: undefined, isLoading: true, isError: false };
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    expect(result.current.isLoading).toBe(true);
  });
});
