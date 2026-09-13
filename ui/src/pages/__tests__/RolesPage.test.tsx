// RolesPage tests — org-scoped custom-role management (v0.4 RBAC).
//
// Covers:
//   (a) the page lists roles (built-in + custom) from a mocked hook;
//   (b) create-role submits name + selected permission keys to the create hook;
//   (c) the permission multi-select renders options grouped by scope from a
//       mocked catalog;
//   (d) delete is confirm-first (first click does NOT mutate; a confirm control
//       must be clicked to fire the delete);
//   + built-in roles are read-only (no delete control).
//
// RBAC role endpoints are NOT enterprise-gated (verified against the Go control
// plane — see the report), so there is no 402 locked-panel path to assert here.
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { RolesPage } from '../RolesPage';
import type { CustomRole, PermissionDescriptor } from '../../api/types';

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/queries', () => ({
  useRoles: vi.fn(),
  usePermissionCatalog: vi.fn(),
  useCreateRole: vi.fn(),
  useUpdateRole: vi.fn(),
  useDeleteRole: vi.fn(),
  useOrganizations: vi.fn(),
}));

import {
  useRoles,
  usePermissionCatalog,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useOrganizations,
} from '../../hooks/queries';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYSTEM_ROLE: CustomRole = {
  id: 'org_admin',
  orgId: '',
  name: 'Organization Administrator',
  description: 'Full access to the organization',
  permissions: ['org:teams:create', 'team:models:deploy'],
  isSystem: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const CUSTOM_ROLE: CustomRole = {
  id: 'role-abc123',
  orgId: 'org-1',
  name: 'ML Engineer',
  description: 'Deploys models and calls inference',
  permissions: ['team:models:deploy', 'inference:call'],
  isSystem: false,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

const CATALOG: PermissionDescriptor[] = [
  { key: 'platform:orgs:create', description: 'Create a new organization', scope: 'platform' },
  { key: 'org:teams:create', description: 'Create a new team', scope: 'org' },
  { key: 'team:models:deploy', description: "Deploy a model to a team's pool", scope: 'team' },
  { key: 'team:keys:create', description: 'Issue an API key for the team', scope: 'team' },
  { key: 'inference:call', description: 'Send requests to the gateway', scope: 'inference' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qr(overrides: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mut(overrides: Record<string, unknown> = {}): any {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

function mockAll(
  roles: CustomRole[] = [],
  opts: { create?: ReturnType<typeof mut>; del?: ReturnType<typeof mut>; update?: ReturnType<typeof mut> } = {},
) {
  vi.mocked(useRoles).mockReturnValue(qr({ data: { roles } }));
  vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: CATALOG } }));
  vi.mocked(useCreateRole).mockReturnValue(opts.create ?? mut());
  vi.mocked(useUpdateRole).mockReturnValue(opts.update ?? mut());
  vi.mocked(useDeleteRole).mockReturnValue(opts.del ?? mut());
}

function renderPage(orgId = 'org-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/platform/orgs/${orgId}/roles`]}>
        <I18nProvider>
          <Routes>
            <Route path="/platform/orgs/:orgId/roles" element={<RolesPage />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (a) lists roles
// ---------------------------------------------------------------------------

describe('RolesPage — role list', () => {
  it('lists both built-in and custom roles from the hook', () => {
    mockAll([SYSTEM_ROLE, CUSTOM_ROLE]);
    renderPage();
    expect(screen.getByText('Organization Administrator')).toBeInTheDocument();
    expect(screen.getByText('ML Engineer')).toBeInTheDocument();
  });

  it('marks built-in roles read-only (no Delete control)', () => {
    mockAll([SYSTEM_ROLE]);
    renderPage();
    // "Built-in" type badge is shown…
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    // …and there is no Delete button for a system role.
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('renders an empty state when there are no roles', () => {
    mockAll([]);
    renderPage();
    expect(screen.getByText(/no custom roles yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (c) permission multi-select grouped by scope
// ---------------------------------------------------------------------------

describe('RolesPage — permission multi-select', () => {
  it('groups catalog permissions by scope in the create modal', () => {
    mockAll([]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));

    const dialog = screen.getByRole('dialog');
    // One group heading per scope present in the catalog.
    expect(within(dialog).getByText('Platform')).toBeInTheDocument();
    expect(within(dialog).getByText('Organization')).toBeInTheDocument();
    expect(within(dialog).getByText('Team')).toBeInTheDocument();
    expect(within(dialog).getByText('Inference')).toBeInTheDocument();

    // Each permission renders as a checkbox keyed on its permission string.
    expect(within(dialog).getByRole('checkbox', { name: /platform:orgs:create/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /team:models:deploy/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /inference:call/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (b) create submits name + selected permission keys
// ---------------------------------------------------------------------------

describe('RolesPage — create role', () => {
  it('submits the name and the selected permission keys to the create hook', async () => {
    const createMutate = vi.fn();
    mockAll([], { create: mut({ mutate: createMutate }) });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Role name'), {
      target: { value: 'Deployer' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /team:models:deploy/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /inference:call/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: /save role/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const arg = createMutate.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({ name: 'Deployer' }),
    );
    expect(arg.permissions).toEqual(
      expect.arrayContaining(['team:models:deploy', 'inference:call']),
    );
    expect(arg.permissions).toHaveLength(2);
  });

  it('keeps Save disabled until a name is entered', async () => {
    mockAll([]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /save role/i })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Role name'), { target: { value: 'X' } });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /save role/i })).not.toBeDisabled(),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) delete is confirm-first
// ---------------------------------------------------------------------------

describe('RolesPage — delete role (confirm-first)', () => {
  it('does not delete on the first click and requires a confirm', () => {
    const deleteMutate = vi.fn();
    mockAll([CUSTOM_ROLE], { del: mut({ mutate: deleteMutate }) });
    renderPage();

    // First click arms the confirm — must NOT mutate.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(deleteMutate).not.toHaveBeenCalled();

    // A confirm control appears; clicking it fires the delete with the role id.
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    expect(deleteMutate).toHaveBeenCalledWith('role-abc123');
  });

  it('cancel during confirm reverts to normal delete button', () => {
    const deleteMutate = vi.fn();
    mockAll([CUSTOM_ROLE], { del: mut({ mutate: deleteMutate }) });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    // Cancel button appears
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    // Delete button visible again, mutation never called
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDefined();
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) loading and error states
// ---------------------------------------------------------------------------

describe('RolesPage — loading and error states', () => {
  it('shows loading block while roles are loading', () => {
    vi.mocked(useRoles).mockReturnValue(qr({ isLoading: true }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: CATALOG } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());
    renderPage();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows error state when roles query fails', () => {
    vi.mocked(useRoles).mockReturnValue(qr({ isError: true, error: new Error('Server error') }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: CATALOG } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (f) edit role — opens modal pre-populated with the role's existing data
// ---------------------------------------------------------------------------

describe('RolesPage — edit role', () => {
  it('opens edit modal pre-populated with existing name and permissions', () => {
    mockAll([CUSTOM_ROLE]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = screen.getByRole('dialog');

    // Name field should have the existing role name
    const nameInput = within(dialog).getByLabelText('Role name') as HTMLInputElement;
    expect(nameInput.value).toBe('ML Engineer');

    // Pre-selected permissions should be checked
    expect(within(dialog).getByRole('checkbox', { name: /team:models:deploy/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /inference:call/ })).toBeChecked();
  });

  it('submits update with modified name and permissions', async () => {
    const updateMutate = vi.fn();
    mockAll([CUSTOM_ROLE], { update: mut({ mutate: updateMutate }) });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Role name'), { target: { value: 'Senior ML Engineer' } });
    // Uncheck one permission
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /inference:call/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: /save role/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const arg = updateMutate.mock.calls[0][0];
    expect(arg.data.name).toBe('Senior ML Engineer');
    expect(arg.data.permissions).not.toContain('inference:call');
  });
});

// ---------------------------------------------------------------------------
// (g) RolesOrgPicker — no orgId in URL (governance nav path)
// ---------------------------------------------------------------------------

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/platform/roles']}>
        <I18nProvider>
          <Routes>
            <Route path="/platform/roles" element={<RolesPage />} />
            <Route path="/platform/orgs/:orgId/roles" element={<div>ROLES_FOR_ORG</div>} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// (h) RoleRow — permission display edge cases
// ---------------------------------------------------------------------------

describe('RolesPage — RoleRow permission display', () => {
  it('shows dash when role has zero permissions', () => {
    const emptyRole: CustomRole = { ...CUSTOM_ROLE, id: 'empty', permissions: [] };
    mockAll([emptyRole]);
    renderPage();
    // The '—' span appears when permissions.length === 0
    const dash = screen.getByText('—');
    expect(dash).toBeInTheDocument();
  });

  it('shows "+N more" when role has more than 3 permissions', () => {
    const bigRole: CustomRole = {
      ...CUSTOM_ROLE,
      id: 'big',
      permissions: ['p:a', 'p:b', 'p:c', 'p:d', 'p:e'],
    };
    mockAll([bigRole]);
    renderPage();
    // First 3 shown as inline-code, 2 extras → "+2 more" text
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (i) RolesOrgPicker — error state
// ---------------------------------------------------------------------------

describe('RolesPage — org picker error state', () => {
  it('shows error state when useOrganizations fails', () => {
    vi.mocked(useOrganizations).mockReturnValue(
      qr({ isError: true, error: new Error('Network error') }),
    );
    vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: [] } }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: [] } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());

    renderPicker();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
  });
});

describe('RolesPage — org picker (no orgId in URL)', () => {
  it('renders org picker when no orgId param', () => {
    vi.mocked(useOrganizations).mockReturnValue(
      qr({ data: { organizations: [{ id: 'org-1', name: 'Acme', slug: 'acme', created_at: '', updated_at: '' }] } }),
    );
    // Must also provide the other mocks (used in RolesManager but not in this render path)
    vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: [] } }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: CATALOG } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());

    renderPicker();
    // Picker shows a select with the org name
    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument();
  });

  it('navigates to org-scoped roles when an org is selected', () => {
    vi.mocked(useOrganizations).mockReturnValue(
      qr({ data: { organizations: [{ id: 'org-navigate', name: 'Navigate Corp', slug: 'nav', created_at: '', updated_at: '' }] } }),
    );
    vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: [] } }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: CATALOG } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());

    renderPicker();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'org-navigate' } });
    expect(screen.getByText('ROLES_FOR_ORG')).toBeInTheDocument();
  });

  it('shows empty state when there are no orgs', () => {
    vi.mocked(useOrganizations).mockReturnValue(
      qr({ data: { organizations: [] } }),
    );
    vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: [] } }));
    vi.mocked(usePermissionCatalog).mockReturnValue(qr({ data: { permissions: [] } }));
    vi.mocked(useCreateRole).mockReturnValue(mut());
    vi.mocked(useUpdateRole).mockReturnValue(mut());
    vi.mocked(useDeleteRole).mockReturnValue(mut());

    renderPicker();
    expect(screen.getByText(/no organizations yet/i)).toBeInTheDocument();
  });
});
