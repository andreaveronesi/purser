/**
 * Auth test helpers — MockAuthProvider for unit tests that need a controlled
 * AuthContext without spinning up a QueryClient or hitting the /me endpoint.
 *
 * Default: dev-mode (isDevMode=true, isAuthenticated=true) — safe for tests
 * that just want to render a protected component without worrying about auth.
 *
 * Usage:
 *   render(<MyPage />, { wrapper: (p) => <MockAuthProvider {...p} /> });
 *
 *   // Authenticated with a real user:
 *   render(<MyPage />, {
 *     wrapper: (p) => (
 *       <MockAuthProvider user={mockUser} isDevMode={false} {...p} />
 *     ),
 *   });
 *
 *   // Unauthenticated (e.g. to test redirect behaviour):
 *   render(<MyPage />, {
 *     wrapper: (p) => (
 *       <MockAuthProvider isAuthenticated={false} isDevMode={false} {...p} />
 *     ),
 *   });
 */
import type { ReactNode } from 'react';
import { AuthContext } from '../lib/auth';
import type { AuthContextValue } from '../lib/auth';
import type { CurrentUser } from '../api/types';

interface MockAuthProviderProps {
  children: ReactNode;
  user?: CurrentUser | null;
  isLoading?: boolean;
  isAuthenticated?: boolean;
  isDevMode?: boolean;
}

/**
 * Provides a controlled AuthContext value without touching the network.
 * Defaults to dev-mode (isDevMode=true, isAuthenticated=true, user=null).
 */
export function MockAuthProvider({
  children,
  user = null,
  isLoading = false,
  isDevMode = true,
  isAuthenticated,
}: MockAuthProviderProps) {
  // Compute isAuthenticated from props: explicit override takes priority,
  // otherwise derive from isDevMode / user presence.
  const auth = isAuthenticated !== undefined ? isAuthenticated : (isDevMode || user != null);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: auth,
    isDevMode,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Pre-built authenticated user for use in tests. */
export const TEST_USER: CurrentUser = {
  actor: 'test-user',
  email: 'test@example.com',
  role: 'platform_admin',
  isPlatformAdmin: true,
  isOrgAdmin: false,
  orgs: [],
  teams: [],
};
