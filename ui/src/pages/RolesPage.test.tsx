/**
 * RolesPage — unit tests.
 *
 * Covers: RolesOrgPicker (no-org empty state + CTA, org selection),
 * and RolesManager (list roles, create, delete).
 *
 * W1: empty state in RolesOrgPicker must explain that roles are org-scoped
 * and must render a "Create Organization" CTA linking to /platform/orgs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RolesPage } from './RolesPage';

vi.mock('../i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => {
    if (!vars) return key;
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key);
  },
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
}));

vi.mock('../hooks/queries', () => ({
  useOrganizations: vi.fn(),
  useRoles: vi.fn(),
  usePermissions: vi.fn(),
  useCreateRole: vi.fn(),
  useUpdateRole: vi.fn(),
  useDeleteRole: vi.fn(),
}));

import * as queries from '../hooks/queries';

const mq = queries as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mkOrg(overrides: Partial<import('../api/types').Organization> = {}): import('../api/types').Organization {
  return {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme',
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const idleMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  error: null,
});

function orgsSuccess(orgs: import('../api/types').Organization[]) {
  return { data: { organizations: orgs }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

function renderOrgPicker() {
  return render(
    <MemoryRouter initialEntries={['/platform/roles']}>
      <Routes>
        <Route path="/platform/roles" element={<RolesPage />} />
        <Route path="/platform/orgs" element={<div data-testid="orgs-page">ORGS</div>} />
        <Route path="/platform/orgs/:orgId/roles" element={<div>ROLES_ORG</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderRolesManager(orgId = 'acme') {
  return render(
    <MemoryRouter initialEntries={[`/platform/orgs/${orgId}/roles`]}>
      <Routes>
        <Route path="/platform/orgs/:orgId/roles" element={<RolesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mq.useOrganizations.mockReturnValue(orgsSuccess([]));
  mq.useRoles.mockReturnValue({ data: { roles: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mq.usePermissions.mockReturnValue({ data: { permissions: [] }, isLoading: false, isError: false, error: null });
  mq.useCreateRole.mockReturnValue(idleMutation());
  mq.useUpdateRole.mockReturnValue(idleMutation());
  mq.useDeleteRole.mockReturnValue(idleMutation());
});

// ---------------------------------------------------------------------------
// RolesOrgPicker — no orgs
// ---------------------------------------------------------------------------

describe('RolesOrgPicker — empty state (W1)', () => {
  it('shows noOrgs empty state when no organizations exist', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([]));
    renderOrgPicker();
    expect(screen.getByText('roles.picker.noOrgs')).toBeDefined();
  });

  it('renders Create Organization CTA button/link in empty state (W1)', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([]));
    renderOrgPicker();
    // CTA must be present — either a link or button with the createOrgCta key
    expect(screen.getByText('roles.picker.createOrgCta')).toBeDefined();
  });

  it('Create Organization CTA links to /platform/orgs (W1)', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([]));
    renderOrgPicker();
    const link = screen.getByRole('link', { name: 'roles.picker.createOrgCta' });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).getAttribute('href')).toBe('/platform/orgs');
  });
});

// ---------------------------------------------------------------------------
// RolesOrgPicker — with orgs
// ---------------------------------------------------------------------------

describe('RolesOrgPicker — with orgs', () => {
  it('renders org selector when organizations exist', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([mkOrg()]));
    renderOrgPicker();
    expect(screen.getByText('Acme Corp')).toBeDefined();
  });

  it('renders the picker card title', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([mkOrg()]));
    renderOrgPicker();
    expect(screen.getByText('roles.picker.title')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// RolesManager — loaded via org-scoped route
// ---------------------------------------------------------------------------

describe('RolesManager — empty roles', () => {
  it('shows no-roles empty state when org has no custom roles', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([mkOrg()]));
    mq.useRoles.mockReturnValue({ data: { roles: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderRolesManager();
    expect(screen.getByText('roles.empty.title')).toBeDefined();
  });

  it('shows create role button in manager view', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([mkOrg()]));
    mq.useRoles.mockReturnValue({ data: { roles: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderRolesManager();
    expect(screen.getByRole('button', { name: 'roles.create' })).toBeDefined();
  });
});
