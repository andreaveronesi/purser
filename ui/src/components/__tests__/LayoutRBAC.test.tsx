// LayoutRBAC.test.tsx — role-based nav section visibility and dev-mode banner.
//
// Verifies that the correct NavSections are shown/hidden based on the auth
// context injected via MockAuthProvider, and that the dev-mode banner appears
// when isDevMode is true.
//
// The default context (no provider) is dev-mode — all sections visible. These
// tests explicitly inject non-dev-mode states to cover the RBAC filtering.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { ThemeProvider } from '../../lib/theme';
import { MockAuthProvider } from '../../test/auth-helpers';
import { Layout } from '../Layout';
import type { CurrentUser } from '../../api/types';

// Convenience alias — auth props without the React children wrapper.
type AuthProps = {
  isDevMode?: boolean;
  isAuthenticated?: boolean;
  user?: CurrentUser | null;
};

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeRouter(initialPath: string = '/') {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true,                   element: <div>Home</div> },
          { path: 'fleet',                 element: <div>Fleet</div> },
          { path: 'audit',                 element: <div>Audit</div> },
          { path: 'slo',                   element: <div>SLO</div> },
          { path: 'platform/dataplanes',   element: <div>DataPlanes</div> },
          { path: 'platform/orgs',         element: <div>Orgs</div> },
          { path: 'join-token',            element: <div>JoinToken</div> },
          { path: 'config',                element: <div>Config</div> },
          { path: 'settings',              element: <div>Settings</div> },
          { path: '*',                     element: <div>NotFound</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
}

function makeViewer(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    actor: 'test-user',
    email: 'test@example.com',
    role: 'viewer',
    isPlatformAdmin: false,
    isOrgAdmin: false,
    orgs: [],
    teams: [],
    ...overrides,
  };
}

function renderWithAuth(authProps: AuthProps, initialPath: string = '/') {
  const router = makeRouter(initialPath);
  return render(
    <MockAuthProvider {...authProps}>
      <ThemeProvider>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </ThemeProvider>
    </MockAuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// Non-admin viewer: only INFERENCE visible
// ---------------------------------------------------------------------------

describe('Layout RBAC — non-admin viewer', () => {
  const auth = { isDevMode: false, isAuthenticated: true, user: makeViewer() };

  it('shows INFERENCE section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Inference')).toBeInTheDocument();
  });

  it('does NOT show PLATFORM section', () => {
    renderWithAuth(auth);
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('does NOT show GOVERNANCE section', () => {
    renderWithAuth(auth);
    expect(screen.queryByText('Governance')).not.toBeInTheDocument();
  });

  it('does NOT show OBSERVABILITY section', () => {
    renderWithAuth(auth);
    expect(screen.queryByText('Observability')).not.toBeInTheDocument();
  });

  it('does NOT show ADMINISTRATION section', () => {
    renderWithAuth(auth);
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('does not show the dev-mode banner', () => {
    renderWithAuth(auth);
    expect(screen.queryByTestId('devmode-banner')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Org-admin: INFERENCE + PLATFORM + GOVERNANCE + OBSERVABILITY, NOT ADMINISTRATION
// ---------------------------------------------------------------------------

describe('Layout RBAC — org_admin', () => {
  const auth = {
    isDevMode: false,
    isAuthenticated: true,
    user: makeViewer({ isOrgAdmin: true, role: 'org_admin' }),
  };

  it('shows INFERENCE section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Inference')).toBeInTheDocument();
  });

  it('shows PLATFORM section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('shows GOVERNANCE section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Governance')).toBeInTheDocument();
  });

  it('shows OBSERVABILITY section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Observability')).toBeInTheDocument();
  });

  it('does NOT show ADMINISTRATION section', () => {
    renderWithAuth(auth);
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('does not show the dev-mode banner', () => {
    renderWithAuth(auth);
    expect(screen.queryByTestId('devmode-banner')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Platform-admin: all 5 sections visible
// ---------------------------------------------------------------------------

describe('Layout RBAC — platform_admin', () => {
  const auth = {
    isDevMode: false,
    isAuthenticated: true,
    user: makeViewer({ isPlatformAdmin: true, role: 'platform_admin' }),
  };

  it('shows INFERENCE section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Inference')).toBeInTheDocument();
  });

  it('shows PLATFORM section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('shows GOVERNANCE section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Governance')).toBeInTheDocument();
  });

  it('shows OBSERVABILITY section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Observability')).toBeInTheDocument();
  });

  it('shows ADMINISTRATION section', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Administration')).toBeInTheDocument();
  });

  it('does not show the dev-mode banner', () => {
    renderWithAuth(auth);
    expect(screen.queryByTestId('devmode-banner')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dev-mode: all 5 sections + banner
// ---------------------------------------------------------------------------

describe('Layout RBAC — dev-mode', () => {
  const auth = { isDevMode: true, isAuthenticated: true, user: null };

  it('shows all 5 sections', () => {
    renderWithAuth(auth);
    expect(screen.getByText('Inference')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Governance')).toBeInTheDocument();
    expect(screen.getByText('Observability')).toBeInTheDocument();
    expect(screen.getByText('Administration')).toBeInTheDocument();
  });

  it('shows the dev-mode banner', () => {
    renderWithAuth(auth);
    expect(screen.getByTestId('devmode-banner')).toBeInTheDocument();
  });

  it('banner contains the expected dev-mode text', () => {
    renderWithAuth(auth);
    const banner = screen.getByTestId('devmode-banner');
    expect(banner.textContent).toMatch(/development mode/i);
  });
});
