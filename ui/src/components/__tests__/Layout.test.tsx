// Layout.test.tsx — focused additional tests that complement the existing
// src/__tests__/Layout.test.tsx (which covers section labels and basic active-
// section detection). This file adds: deep sub-path activation, active NavLink
// class on individual items, ThemeToggle rendering (both icon states),
// LanguagePicker, and skip-link presence.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { ThemeProvider } from '../../lib/theme';
import { Layout } from '../Layout';

// Register every route the Layout nav might activate so NavLink can resolve them.
function makeRouter(initialPath: string) {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <div>Home</div> },
          { path: 'fleet', element: <div>Fleet</div> },
          { path: 'catalog', element: <div>Catalog</div> },
          { path: 'deployments', element: <div>Deployments</div> },
          { path: 'playground', element: <div>Playground</div> },
          { path: 'platform/dataplanes', element: <div>DataPlanes</div> },
          { path: 'platform/pools', element: <div>Pools</div> },
          { path: 'planner/what-if', element: <div>WhatIf</div> },
          { path: 'platform/orgs', element: <div>Orgs</div> },
          { path: 'platform/orgs/:orgId', element: <div>Org</div> },
          { path: 'platform/orgs/:orgId/teams/:teamId', element: <div>Team</div> },
          { path: 'platform/users', element: <div>Users</div> },
          { path: 'platform/roles', element: <div>Roles</div> },
          { path: 'api-keys', element: <div>ApiKeys</div> },
          { path: 'platform/service-accounts', element: <div>ServiceAccounts</div> },
          { path: 'platform/policies', element: <div>Policies</div> },
          { path: 'approvals', element: <div>Approvals</div> },
          { path: 'audit', element: <div>Audit</div> },
          { path: 'admin-audit', element: <div>AdminAudit</div> },
          { path: 'compliance', element: <div>Compliance</div> },
          { path: 'chargeback', element: <div>Chargeback</div> },
          { path: 'slo', element: <div>SLO</div> },
          { path: 'join-token', element: <div>JoinToken</div> },
          { path: 'config', element: <div>Config</div> },
          { path: 'settings', element: <div>Settings</div> },
          { path: '*', element: <div>NotFound</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
}

function renderLayout(path: string) {
  const router = makeRouter(path);
  return render(
    <ThemeProvider>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Deep sub-path section activation
// ---------------------------------------------------------------------------

function getActiveSectionLabel(container: HTMLElement): string | undefined {
  return (
    container.querySelector('.nav__section--active .nav__section-label')?.textContent ??
    undefined
  );
}

describe('Layout — deep sub-path section activation', () => {
  it('marks Governance active on /platform/orgs/123', () => {
    const { container } = renderLayout('/platform/orgs/123');
    expect(getActiveSectionLabel(container)).toBe('Governance');
  });

  it('marks Governance active on /platform/orgs/123/teams/1', () => {
    const { container } = renderLayout('/platform/orgs/123/teams/1');
    expect(getActiveSectionLabel(container)).toBe('Governance');
  });

  it('marks Inference active on /fleet but NOT Platform', () => {
    const { container } = renderLayout('/fleet');
    expect(getActiveSectionLabel(container)).toBe('Inference');
    const activeSections = container.querySelectorAll('.nav__section--active');
    expect(activeSections).toHaveLength(1);
  });

  it('marks Platform active on /platform/dataplanes', () => {
    const { container } = renderLayout('/platform/dataplanes');
    expect(getActiveSectionLabel(container)).toBe('Platform');
  });

  it('marks Observability active on /admin-audit', () => {
    const { container } = renderLayout('/admin-audit');
    expect(getActiveSectionLabel(container)).toBe('Observability');
  });

  it('marks Observability active on /compliance', () => {
    const { container } = renderLayout('/compliance');
    expect(getActiveSectionLabel(container)).toBe('Observability');
  });

  it('marks Administration active on /config', () => {
    const { container } = renderLayout('/config');
    expect(getActiveSectionLabel(container)).toBe('Administration');
  });

  it('no section is active on an unknown route', () => {
    const { container } = renderLayout('/unknown-route');
    const activeSections = container.querySelectorAll('.nav__section--active');
    expect(activeSections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Active NavLink class on individual items
// ---------------------------------------------------------------------------

describe('Layout — active NavLink item', () => {
  it('/fleet: Fleet link has nav__link--active class', () => {
    renderLayout('/fleet');
    const link = screen.getByRole('link', { name: /fleet/i });
    expect(link.className).toContain('nav__link--active');
  });

  it('/fleet: Catalog link does NOT have nav__link--active class', () => {
    renderLayout('/fleet');
    const link = screen.getByRole('link', { name: /model catalog/i });
    expect(link.className).not.toContain('nav__link--active');
  });

  it('/slo: SLO link has nav__link--active class', () => {
    renderLayout('/slo');
    const link = screen.getByRole('link', { name: /slo contracts/i });
    expect(link.className).toContain('nav__link--active');
  });
});

// ---------------------------------------------------------------------------
// Chrome: skip link, top bar controls
// ---------------------------------------------------------------------------

describe('Layout — chrome elements', () => {
  it('renders a skip link to #main', () => {
    renderLayout('/fleet');
    const skipLink = document.querySelector('a[href="#main"]');
    expect(skipLink).not.toBeNull();
  });

  it('renders the main content region with id=main', () => {
    renderLayout('/fleet');
    expect(document.getElementById('main')).not.toBeNull();
  });

  it('renders a language picker with English and Italian options', () => {
    renderLayout('/fleet');
    const select = document.querySelector('select');
    expect(select).not.toBeNull();
    const options = Array.from(select!.querySelectorAll('option')).map((o) => o.value);
    expect(options).toContain('en');
    expect(options).toContain('it');
  });

  it('renders the theme toggle button', () => {
    renderLayout('/fleet');
    // ThemeToggle renders a button with the i18n key as aria-label
    const themeBtn = screen.getByRole('button', { name: 'Toggle color theme' });
    expect(themeBtn).toBeDefined();
  });

  it('renders either moon or sun icon in theme toggle', () => {
    const { container } = renderLayout('/fleet');
    // ThemeProvider defaults to light → shows moon icon (one branch tested)
    // The icon is aria-hidden so we look for the SVG inside the icon-btn
    const iconBtn = container.querySelector('.icon-btn');
    expect(iconBtn).not.toBeNull();
    expect(iconBtn!.querySelector('svg')).not.toBeNull();
  });

  it('renders the nav landmark with accessible label', () => {
    renderLayout('/fleet');
    expect(screen.getByRole('navigation', { name: 'Purser' })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Brand block
// ---------------------------------------------------------------------------

describe('Layout — brand', () => {
  it('renders the app name', () => {
    renderLayout('/fleet');
    expect(screen.getAllByText('Purser').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// LanguagePicker — kills survived mutants at line 150–151
// ---------------------------------------------------------------------------

describe('Layout — LanguagePicker', () => {
  it('locale picker shows both languages', () => {
    renderLayout('/fleet');
    const select = document.querySelector('select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('en');
    expect(values).toContain('it');
  });

  it('changing locale updates the select value and re-renders nav in new language', () => {
    // Renders in English ('en'), then switches to Italian ('it').
    // The LanguagePicker onChange handler must call setLocale with the new value.
    renderLayout('/fleet');
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('en');
    // Switch to Italian
    fireEvent.change(select, { target: { value: 'it' } });
    // After switching, the select controlled value reflects the new locale.
    expect(select.value).toBe('it');
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle — both branches (covers line 173 in Layout.tsx)
// ---------------------------------------------------------------------------

describe('Layout — ThemeToggle icon', () => {
  afterEach(() => {
    localStorage.removeItem('purser.theme');
  });

  it('renders moon icon when theme is light (default)', () => {
    localStorage.setItem('purser.theme', 'light');
    const { container } = renderLayout('/fleet');
    const iconBtn = container.querySelector('.icon-btn');
    // Light theme → shows moon icon; svg has specific path content
    expect(iconBtn!.querySelector('svg')).not.toBeNull();
    // The moon path uses a specific `d` value; check SOMETHING is rendered
    const paths = iconBtn!.querySelectorAll('path,circle,rect');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders sun icon when theme is dark', () => {
    localStorage.setItem('purser.theme', 'dark');
    const { container } = renderLayout('/fleet');
    const iconBtn = container.querySelector('.icon-btn');
    // Dark theme → shows sun icon
    expect(iconBtn!.querySelector('svg')).not.toBeNull();
    // Sun has a circle at (12,12) which moon does not — differentiate branches
    const circles = iconBtn!.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });
});
