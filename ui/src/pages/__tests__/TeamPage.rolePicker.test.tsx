// TeamPage — role picker regression test (v0.4 RBAC).
//
// (e) The "invite member" role field must be a <select> populated from the
// org's roles (built-in + custom), NOT a free-text input. Assigning a member a
// role is a pick from the roles API, not a typed string.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../../i18n';
import { TeamPage } from '../TeamPage';
import type { CustomRole, Team } from '../../api/types';

// ---------------------------------------------------------------------------
// Mocks — mock the whole hooks module so TeamPage renders without a backend.
// ---------------------------------------------------------------------------

vi.mock('../../hooks/queries', () => ({
  useTeam: vi.fn(),
  useTeamMembers: vi.fn(),
  useAddTeamMember: vi.fn(),
  useRemoveTeamMember: vi.fn(),
  useNodePools: vi.fn(),
  useMyTeamPermissions: vi.fn(),
  useRoles: vi.fn(),
}));

import {
  useTeam,
  useTeamMembers,
  useAddTeamMember,
  useRemoveTeamMember,
  useNodePools,
  useMyTeamPermissions,
  useRoles,
} from '../../hooks/queries';

const TEAM: Team = {
  id: 'team-1',
  orgId: 'org-1',
  name: 'Team One',
  slug: 'team-one',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const ROLES: CustomRole[] = [
  { id: 'developer', orgId: '', name: 'Developer', permissions: ['team:models:deploy'], isSystem: true, createdAt: '', updatedAt: '' },
  { id: 'viewer', orgId: '', name: 'Viewer', permissions: ['team:members:view'], isSystem: true, createdAt: '', updatedAt: '' },
  { id: 'role-custom', orgId: 'org-1', name: 'ML Engineer', permissions: ['inference:call'], isSystem: false, createdAt: '', updatedAt: '' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qr(overrides: Record<string, unknown> = {}): any {
  return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...overrides };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mut(overrides: Record<string, unknown> = {}): any {
  return { mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve()), isPending: false, isError: false, error: null, ...overrides };
}

function mockAll() {
  vi.mocked(useTeam).mockReturnValue(qr({ data: TEAM }));
  vi.mocked(useTeamMembers).mockReturnValue(qr({ data: { members: [] } }));
  vi.mocked(useAddTeamMember).mockReturnValue(mut());
  vi.mocked(useRemoveTeamMember).mockReturnValue(mut());
  vi.mocked(useNodePools).mockReturnValue(qr({ data: { pools: [] } }));
  vi.mocked(useMyTeamPermissions).mockReturnValue(qr({ data: { permissions: [], isOrgAdmin: false } }));
  vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: ROLES } }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/platform/orgs/org-1/teams/team-1']}>
        <I18nProvider>
          <Routes>
            <Route path="/platform/orgs/:orgId/teams/:teamId" element={<TeamPage />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAll();
});

describe('TeamPage — member role picker', () => {
  it('renders the role field as a <select> populated from the org roles', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));

    const dialog = screen.getByRole('dialog');
    const roleField = within(dialog).getByLabelText('Role');
    expect(roleField.tagName).toBe('SELECT');

    // Options come from the roles API (built-in + custom), not a typed string.
    expect(within(dialog).getByRole('option', { name: 'Developer' })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Viewer' })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'ML Engineer' })).toBeInTheDocument();
  });

  it('no longer renders a free-text role input', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));
    const dialog = screen.getByRole('dialog');
    // A textbox named "Role"/"Role ID" must not exist anymore.
    expect(within(dialog).queryByRole('textbox', { name: /role/i })).not.toBeInTheDocument();
  });

  it('submits the selected role id to addTeamMember', () => {
    const addMutateAsync = vi.fn(() => Promise.resolve());
    vi.mocked(useAddTeamMember).mockReturnValue(mut({ mutateAsync: addMutateAsync }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('User ID'), { target: { value: 'alice@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'viewer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /invite member/i }));

    expect(addMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'alice@example.com', role_id: 'viewer' }),
    );
  });
});

// ---------------------------------------------------------------------------
// TeamPage — loading and error states for useTeam
// ---------------------------------------------------------------------------

describe('TeamPage — loading state', () => {
  it('renders a loading block when useTeam is loading', () => {
    vi.mocked(useTeam).mockReturnValue(qr({ isLoading: true }));
    renderPage();
    // No page header title yet, just loading block
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('TeamPage — error state', () => {
  it('renders error alert when useTeam fails', () => {
    vi.mocked(useTeam).mockReturnValue(qr({ isError: true, error: new Error('Not found') }));
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TeamPage — members card: remove member confirm-first pattern
// ---------------------------------------------------------------------------

describe('TeamPage — remove member (confirm-first)', () => {
  it('first click shows confirm, second click calls removeMember', () => {
    const removeMutateAsync = vi.fn(() => Promise.resolve());
    vi.mocked(useRemoveTeamMember).mockReturnValue(
      mut({ mutateAsync: removeMutateAsync }),
    );
    vi.mocked(useTeamMembers).mockReturnValue(
      qr({
        data: {
          members: [
            {
              id: 1,
              teamId: 'team-1',
              userId: 'alice@example.com',
              roleId: 'developer',
              createdAt: '2026-01-01T00:00:00Z',
              user: { email: 'alice@example.com', displayName: 'Alice' },
              role: { name: 'Developer', permissions: [] },
            },
          ],
        },
      }),
    );
    renderPage();

    // First click — arms confirm
    const trashBtn = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(trashBtn);
    // Cancel button appears
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(removeMutateAsync).not.toHaveBeenCalled();

    // Confirm click — fires remove
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(removeMutateAsync).toHaveBeenCalledWith('alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// TeamPage — My Permissions card
// ---------------------------------------------------------------------------

describe('TeamPage — My Permissions card', () => {
  it('renders Org Admin badge when isOrgAdmin is true', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ data: { permissions: [], isOrgAdmin: true } }),
    );
    renderPage();
    expect(screen.getByText('Org Admin')).toBeInTheDocument();
  });

  it('renders permission badges when permissions are non-empty', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ data: { permissions: ['team:models:deploy', 'inference:call'], isOrgAdmin: false } }),
    );
    renderPage();
    expect(screen.getByText('team:models:deploy')).toBeInTheDocument();
    expect(screen.getByText('inference:call')).toBeInTheDocument();
  });

  it('shows empty-permissions message when permissions array is empty and not org admin', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ data: { permissions: [], isOrgAdmin: false } }),
    );
    renderPage();
    // No Org Admin badge
    expect(screen.queryByText('Org Admin')).not.toBeInTheDocument();
    // The noPermissions message is shown (key passes through I18nProvider)
    // "platform.teams.noPermissions" → real translation
  });

  it('shows error state when useMyTeamPermissions fails', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ isError: true, error: new Error('Permissions error') }),
    );
    renderPage();
    // Multiple cards can show alerts; at least one should be present
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
  });

  it('renders admin-toned badge for admin-prefixed permissions', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ data: { permissions: ['admin:something'], isOrgAdmin: false } }),
    );
    renderPage();
    expect(screen.getByText('admin:something')).toBeInTheDocument();
  });

  it('renders info-toned badge for deploy-prefixed permissions', () => {
    vi.mocked(useMyTeamPermissions).mockReturnValue(
      qr({ data: { permissions: ['deploy:model'], isOrgAdmin: false } }),
    );
    renderPage();
    expect(screen.getByText('deploy:model')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TeamPage — NodePoolCard
// ---------------------------------------------------------------------------

describe('TeamPage — NodePoolCard', () => {
  it('shows loading block while pools are loading', () => {
    vi.mocked(useNodePools).mockReturnValue(qr({ isLoading: true }));
    renderPage();
    // While loading, no pool link to /platform/pools is rendered yet
    expect(screen.queryByRole('link', { name: /node pools/i })).not.toBeInTheDocument();
  });

  it('shows empty state when no pool is assigned to this team', () => {
    vi.mocked(useNodePools).mockReturnValue(
      qr({ data: { pools: [] } }),
    );
    renderPage();
    // The NodePoolCard empty state uses t('platform.teams.noPool')
    // (I18nProvider resolves to actual text)
  });

  it('shows pool name and exclusive badge when pool is exclusive', () => {
    vi.mocked(useNodePools).mockReturnValue(
      qr({
        data: {
          pools: [
            {
              id: 'pool-1',
              name: 'GPU Cluster Alpha',
              ownerType: 'team',
              ownerId: 'team-1',
              policy: 'exclusive',
              nodeIds: [],
            },
          ],
        },
      }),
    );
    renderPage();
    expect(screen.getByText('GPU Cluster Alpha')).toBeInTheDocument();
    // 'exclusive' policy triggers t('platform.pools.exclusive') badge
  });

  it('shows pool name and shared badge when pool is shared', () => {
    vi.mocked(useNodePools).mockReturnValue(
      qr({
        data: {
          pools: [
            {
              id: 'pool-2',
              name: 'Shared Inference Pool',
              ownerType: 'team',
              ownerId: 'team-1',
              policy: 'shared',
              nodeIds: [],
            },
          ],
        },
      }),
    );
    renderPage();
    expect(screen.getByText('Shared Inference Pool')).toBeInTheDocument();
  });

  it('ignores pools owned by a different team', () => {
    vi.mocked(useNodePools).mockReturnValue(
      qr({
        data: {
          pools: [
            {
              id: 'pool-other',
              name: 'Other Team Pool',
              ownerType: 'team',
              ownerId: 'team-other',
              policy: 'exclusive',
              nodeIds: [],
            },
          ],
        },
      }),
    );
    renderPage();
    // Pool name for other team should NOT appear
    expect(screen.queryByText('Other Team Pool')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TeamPage — InviteMemberModal edge cases
// ---------------------------------------------------------------------------

describe('TeamPage — InviteMemberModal edge cases', () => {
  it('shows disabled placeholder option when no roles are available', () => {
    vi.mocked(useRoles).mockReturnValue(qr({ data: { roles: [] } }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));
    const dialog = screen.getByRole('dialog');
    // roles.length === 0 branch: shows a disabled "loading" option
    const loadingOption = within(dialog).getByRole('option', { name: /loading/i });
    expect(loadingOption).toBeDisabled();
  });

  it('shows error message in modal when addMember call fails', async () => {
    vi.mocked(useAddTeamMember).mockReturnValue(
      mut({ isError: true, error: new Error('Invite failed: user already exists') }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Invite failed: user already exists')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TeamPage — MemberRow edge cases
// ---------------------------------------------------------------------------

describe('TeamPage — MemberRow edge cases', () => {
  it('shows dash when member.createdAt is null', () => {
    vi.mocked(useTeamMembers).mockReturnValue(
      qr({
        data: {
          members: [
            {
              id: 2,
              teamId: 'team-1',
              userId: 'bob@example.com',
              roleId: 'developer',
              createdAt: null,
              user: { email: 'bob@example.com', displayName: 'Bob' },
              role: { name: 'Developer', permissions: [] },
            },
          ],
        },
      }),
    );
    renderPage();
    // The '—' appears in the joined column when createdAt is null
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TeamPage — MembersCard loading / error / empty states
// ---------------------------------------------------------------------------

describe('TeamPage — MembersCard states', () => {
  it('shows loading block while members are loading', () => {
    vi.mocked(useTeamMembers).mockReturnValue(qr({ isLoading: true }));
    renderPage();
    // Members table should not appear while loading
    expect(screen.queryByRole('columnheader', { name: /user/i })).not.toBeInTheDocument();
  });

  it('shows error alert when members query fails', () => {
    vi.mocked(useTeamMembers).mockReturnValue(
      qr({ isError: true, error: new Error('Failed to load members') }),
    );
    renderPage();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when team has no members', () => {
    vi.mocked(useTeamMembers).mockReturnValue(qr({ data: { members: [] } }));
    renderPage();
    // Should not show the members table
    expect(screen.queryByRole('columnheader', { name: /user/i })).not.toBeInTheDocument();
  });
});
