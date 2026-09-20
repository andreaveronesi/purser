// ---------------------------------------------------------------------------
// AuthContext — global authentication state for the Purser operator UI.
//
// The Provider calls GET /api/v1/platform/users/me on mount (via useMe()) to
// determine whether the current session is authenticated.
//
// Dev-mode: when no auth provider (OIDC) is configured, the backend treats
// every request as authenticated. The UI detects this via config.oidc being
// null and enters "dev mode" — no redirect to /login, no spinner waiting for
// /me, always accessible. This keeps the demo stack working without any auth
// setup and ensures existing tests (which mount components without an
// AuthProvider) continue to pass: the default context value is dev-mode.
// ---------------------------------------------------------------------------
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useMe } from '../hooks/queries';
import { config } from '../api/config';
import type { CurrentUser } from '../api/types';

export interface AuthContextValue {
  /** The authenticated user, or null if loading / unauthenticated. */
  user: CurrentUser | null;
  /** True while the /me request is in flight (only in auth-configured mode). */
  isLoading: boolean;
  /** True if the user has an active session (or if dev-mode). */
  isAuthenticated: boolean;
  /**
   * True when no auth provider (OIDC) is configured. In dev-mode every user
   * has implicit full access — no login screen is shown.
   */
  isDevMode: boolean;
}

// Default value: dev-mode. This is the value seen by any component that calls
// useAuth() without an AuthProvider ancestor. It keeps all existing tests
// passing: they render pages in MemoryRouter without an AuthProvider and still
// see isAuthenticated=true, so ProtectedRoute never redirects.
const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  user: null,
  isLoading: false,
  isAuthenticated: true,
  isDevMode: true,
};

export const AuthContext = createContext<AuthContextValue>(DEFAULT_AUTH_CONTEXT);

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { data: user, isLoading, isError } = useMe();

  // Auth is configured when OIDC or the built-in local admin login is present.
  // If neither is configured, the backend treats every request as authenticated
  // (dev/demo mode).
  const authConfigured = Boolean(config.oidc) || Boolean(config.localAuth);
  const isDevMode = !authConfigured;

  const value = useMemo<AuthContextValue>(() => {
    if (isDevMode) {
      // Dev-mode: no auth configured — always authenticated, never loading.
      return {
        user: user ?? null,
        isLoading: false,
        isAuthenticated: true,
        isDevMode: true,
      };
    }

    // Auth configured: wait for /me to resolve.
    return {
      user: user ?? null,
      isLoading,
      isAuthenticated: !isLoading && !isError && user != null,
      isDevMode: false,
    };
  }, [user, isLoading, isError, isDevMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// useAuth hook
// ---------------------------------------------------------------------------

/** Returns the current auth state. Uses dev-mode defaults when no AuthProvider is present. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Permission helpers — thin wrappers around useAuth() for callsite clarity.
// Always true in dev-mode (no auth configured → backend treats all as admin).
// The backend enforces permissions too — these are UX helpers only.
// ---------------------------------------------------------------------------

/**
 * True if the current user can perform platform-admin–level operations
 * (e.g. create/delete orgs, apply cluster config, generate join tokens).
 * Dev-mode: always true.
 */
export function useCanAdmin(): boolean {
  const { user, isDevMode } = useAuth();
  return isDevMode || Boolean(user?.isPlatformAdmin);
}

/**
 * True if the current user can perform org-admin–level operations
 * (e.g. create pools, roles, API keys, invite members).
 * Dev-mode: always true.
 */
export function useCanOrgAdmin(): boolean {
  const { user, isDevMode } = useAuth();
  return isDevMode || Boolean(user?.isPlatformAdmin) || Boolean(user?.isOrgAdmin);
}
