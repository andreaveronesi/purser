// ---------------------------------------------------------------------------
// ProtectedRoute — guards the app shell against unauthenticated access.
//
// Behaviour by auth state:
//   dev-mode         → pass-through (never redirects; demo is always accessible)
//   loading          → shows a centered spinner while /me is in flight
//   unauthenticated  → redirects to /login
//   authenticated    → renders children
//
// The component reads from AuthContext whose default value is dev-mode, so
// any test that renders this component without an AuthProvider will always
// pass through — existing tests are not affected.
// ---------------------------------------------------------------------------
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isDevMode, isLoading, isAuthenticated } = useAuth();

  // Dev-mode: all content accessible, no redirect, no spinner.
  if (isDevMode) return <>{children}</>;

  // Waiting for /me to resolve — show a minimal loading indicator.
  if (isLoading) {
    return (
      <div className="auth-loading" role="status" aria-label="Authenticating…">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  // No active session and auth is configured → send to login.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
