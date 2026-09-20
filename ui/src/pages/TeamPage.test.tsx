/**
 * TeamPage — unit tests covering the camelCase migration.
 *
 * Verifies that:
 *   - member.userId / member.roleId are used to display email and role
 *   - member.createdAt is used for the "Joined" column
 *   - Remove mutation is called with member.userId (not member.user_id)
 *   - isOrgAdmin badge is rendered when data.isOrgAdmin is true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
}));

vi.mock('../hooks/queries', () => ({
  useTeam: vi.fn(),
  useTeamMembers: vi.fn(),
  useAddTeamMember: vi.fn(),
  useRemoveTeamMember: vi.fn(),
  useNodePools: vi.fn(),
  useMyTeamPermissions: vi.fn(),
  useRoles: vi.fn(),
}));

import { TeamPage } from './TeamPage';
import * as queries from '../hooks/queries';
import type { TeamMember, EffectivePermissions } from '../api/types';

const mq = queries as unknown as Record<string, ReturnType<typeof vi.fn>>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 1,
    teamId: 'team-abc',
    userId: 'user@example.com',
    roleId: 'developer',
    createdAt: '2026-01-15T10:30:00Z',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/platform/orgs/org-1/teams/team-abc']}>
      <Routes>
        <Route path="/platform/orgs/:orgId/teams/:teamId" element={<TeamPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mq.useTeam.mockReturnValue({ data: { id: 'team-abc', name: 'Alpha Team', slug: 'alpha', orgId: 'org-1', createdAt: '', updatedAt: '' }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mq.useTeamMembers.mockReturnValue({ data: { members: [mkMember()] }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mq.useAddTeamMember.mockReturnValue(idleMutation());
  mq.useRemoveTeamMember.mockReturnValue(idleMutation());
  mq.useNodePools.mockReturnValue({ data: { pools: [] }, isLoading: false });
  mq.useMyTeamPermissions.mockReturnValue({ data: { userId: 'current-user', teamId: 'team-abc', orgId: 'org-1', permissions: ['read'], isOrgAdmin: false }, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mq.useRoles.mockReturnValue({ data: { roles: [{ id: 'developer', name: 'Developer', isSystem: true, permissions: [], orgId: '', createdAt: '', updatedAt: '' }] } });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamPage — member list uses camelCase fields', () => {
  it('displays member.userId as the email column', () => {
    renderPage();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('displays member.roleId as the role badge when role object is absent', () => {
    renderPage();
    expect(screen.getByText('developer')).toBeInTheDocument();
  });

  it('displays member.createdAt formatted as a date in the Joined column', () => {
    renderPage();
    // "2026-01-15T10:30:00Z" → locale date string — just check the date cell exists and is non-empty
    const rows = screen.getAllByRole('row');
    // header row + data row
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The data row should contain a date string derived from createdAt
    const dataRow = rows[1];
    // any cell with a recognisable date format (year 2026)
    expect(dataRow.textContent).toMatch(/2026/);
  });

  it('remove mutation is called with member.userId', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mq.useRemoveTeamMember.mockReturnValue({ ...idleMutation(), mutateAsync });

    renderPage();

    // Click the trash icon button (ghost button with aria-label platform.teams.remove)
    const removeBtn = screen.getByRole('button', { name: 'platform.teams.remove' });
    fireEvent.click(removeBtn);

    // Confirm dialog appears with danger button
    const confirmBtn = screen.getByRole('button', { name: 'platform.teams.remove', hidden: false });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mutateAsync).toHaveBeenCalledWith('user@example.com');
  });
});

describe('TeamPage — isOrgAdmin badge', () => {
  it('shows Org Admin badge when isOrgAdmin is true', () => {
    const perms: EffectivePermissions = {
      userId: 'current-user',
      teamId: 'team-abc',
      orgId: 'org-1',
      permissions: ['read'],
      isOrgAdmin: true,
    };
    mq.useMyTeamPermissions.mockReturnValue({ data: perms, isLoading: false, isError: false, error: null, refetch: vi.fn() });

    renderPage();
    expect(screen.getByText('Org Admin')).toBeInTheDocument();
  });

  it('does NOT show Org Admin badge when isOrgAdmin is false', () => {
    renderPage();
    expect(screen.queryByText('Org Admin')).not.toBeInTheDocument();
  });
});

describe('TeamPage — member.user.email takes precedence over userId', () => {
  it('shows user.email when member has a nested user object', () => {
    const memberWithUser: TeamMember = {
      ...mkMember(),
      user: { email: 'resolved@example.com', displayName: 'Alice' },
    };
    mq.useTeamMembers.mockReturnValue({ data: { members: [memberWithUser] }, isLoading: false, isError: false, error: null, refetch: vi.fn() });

    renderPage();
    expect(screen.getByText('resolved@example.com')).toBeInTheDocument();
    // userId fallback should NOT be shown
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument();
  });
});
