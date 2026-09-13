// OrganizationsPage tests — full state-machine coverage.
//
// State machine: loading → error → empty → populated
// Interactions: create org modal (name→slug derivation, submit),
//               delete confirm-first (two-click guard), navigate to teams.
//
// i18n is mocked to echo translation keys for stable assertions.
// useNavigate is spied on to verify navigation without a real router.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { OrganizationsPage } from './OrganizationsPage';
import type { Organization } from '../api/types';

vi.mock('../i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => {
    if (!vars) return key;
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key);
  },
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
}));

// ---------------------------------------------------------------------------
// Mocked hooks
// ---------------------------------------------------------------------------

// Non-resolving async so .then() state updates don't run during assertions.
const { createOrgMutateAsync, deleteOrgMutateAsync } = vi.hoisted(() => ({
  createOrgMutateAsync: vi.fn(() => new Promise<void>(() => {})),
  deleteOrgMutateAsync: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock('../hooks/queries', () => ({
  useOrganizations: vi.fn(),
  useCreateOrganization: () => ({
    mutateAsync: createOrgMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteOrganization: () => ({
    mutateAsync: deleteOrgMutateAsync,
    isPending: false,
  }),
}));

import * as queries from '../hooks/queries';

const mq = queries as unknown as {
  useOrganizations: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    description: 'Test organization',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function orgsSuccess(orgs: Organization[]) {
  return { data: { organizations: orgs }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

function orgsLoading() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
}

function orgsError(message = 'Network error') {
  return { data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() };
}

// ---------------------------------------------------------------------------
// Render helper — wraps in MemoryRouter for useNavigate
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/platform/orgs']}>
      <Routes>
        <Route path="/platform/orgs" element={<OrganizationsPage />} />
        <Route path="/platform/orgs/:orgId/teams" element={<div>TEAMS_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mq.useOrganizations.mockReturnValue(orgsSuccess([]));
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('OrganizationsPage — loading', () => {
  it('renders no table while loading', () => {
    mq.useOrganizations.mockReturnValue(orgsLoading());
    const { container } = renderPage();
    expect(container.querySelector('table')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('OrganizationsPage — error', () => {
  it('shows error state when query fails', () => {
    mq.useOrganizations.mockReturnValue(orgsError('server down'));
    renderPage();
    expect(screen.getByRole('alert')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('OrganizationsPage — empty', () => {
  it('renders empty state when there are no orgs', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([]));
    renderPage();
    expect(screen.getByText('platform.orgs.noOrgs')).toBeDefined();
  });

  it('does not render a table when there are no orgs', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([]));
    const { container } = renderPage();
    expect(container.querySelector('table')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Populated state
// ---------------------------------------------------------------------------

describe('OrganizationsPage — populated', () => {
  it('lists org names in the table', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'o1', name: 'Acme', slug: 'acme' }), mkOrg({ id: 'o2', name: 'Globex', slug: 'globex' })]),
    );
    renderPage();
    expect(screen.getByText('Acme')).toBeDefined();
    expect(screen.getByText('Globex')).toBeDefined();
  });

  it('renders org slug as a badge', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'o1', name: 'Acme', slug: 'acme-corp' })]),
    );
    renderPage();
    expect(screen.getByText('acme-corp')).toBeDefined();
  });

  it('renders description when present', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ description: 'A great organization' })]),
    );
    renderPage();
    expect(screen.getByText('A great organization')).toBeDefined();
  });

  it('renders em-dash when description is absent', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ description: undefined })]),
    );
    renderPage();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders column headers', () => {
    mq.useOrganizations.mockReturnValue(orgsSuccess([mkOrg()]));
    renderPage();
    expect(screen.getByText('platform.orgs.col.name')).toBeDefined();
    expect(screen.getByText('platform.orgs.col.slug')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// View Teams navigation
// ---------------------------------------------------------------------------

describe('OrganizationsPage — View Teams navigation', () => {
  it('navigates to /platform/orgs/:orgId/teams when "View Teams" is clicked', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'org-nav', name: 'NavOrg', slug: 'nav-org' })]),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.viewTeams' }));
    expect(screen.getByText('TEAMS_PAGE')).toBeDefined();
  });

  it('org name button also navigates to the teams route', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'org-btn', name: 'ButtonOrg', slug: 'btn' })]),
    );
    renderPage();
    // The org name is a <button> that triggers navigation
    const nameBtn = screen.getByRole('button', { name: 'ButtonOrg' });
    fireEvent.click(nameBtn);
    expect(screen.getByText('TEAMS_PAGE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Create org modal
// ---------------------------------------------------------------------------

describe('OrganizationsPage — create org modal', () => {
  it('opens create modal when "Create Organization" is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('auto-derives slug from name as the user types', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    const nameInput = screen.getByPlaceholderText('Acme Corp');
    fireEvent.change(nameInput, { target: { value: 'My Great Org' } });
    // Slug should be kebab-case of the name
    const slugInput = screen.getByPlaceholderText('acme-corp');
    expect((slugInput as HTMLInputElement).value).toBe('my-great-org');
  });

  it('strips leading/trailing hyphens from slug', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    const nameInput = screen.getByPlaceholderText('Acme Corp');
    fireEvent.change(nameInput, { target: { value: '  Hello World  ' } });
    const slugInput = screen.getByPlaceholderText('acme-corp');
    expect((slugInput as HTMLInputElement).value).toBe('hello-world');
  });

  it('submit is disabled when name is empty', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    const dialog = screen.getByRole('dialog');
    const submitBtn = within(dialog).getByRole('button', { name: 'platform.orgs.createOrg' });
    expect(submitBtn).toBeDisabled();
  });

  it('calls createOrganization with name, slug and optional description', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'New Org' } });
    // Slug is auto-derived; description is optional
    const descInput = screen.getByPlaceholderText('Optional description');
    fireEvent.change(descInput, { target: { value: 'My new org' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'platform.orgs.createOrg' }));

    expect(createOrgMutateAsync).toHaveBeenCalledTimes(1);
    expect(createOrgMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Org', slug: 'new-org', description: 'My new org' }),
    );
  });

  it('omits description from payload when description is empty', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Clean Org' } });
    // Leave description empty
    fireEvent.click(within(dialog).getByRole('button', { name: 'platform.orgs.createOrg' }));
    expect(createOrgMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ description: undefined }),
    );
  });

  it('closes modal when Cancel is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.createOrg' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'action.cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Delete org — confirm-first pattern (two-click guard)
// ---------------------------------------------------------------------------

describe('OrganizationsPage — delete org (confirm-first)', () => {
  it('first click arms confirm and does NOT mutate immediately', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'org-del', name: 'DeleteMe', slug: 'delete-me' })]),
    );
    renderPage();

    // First click arms confirm — mutation must NOT fire
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.delete' }));
    expect(deleteOrgMutateAsync).not.toHaveBeenCalled();

    // A Cancel button should now appear alongside the armed confirm button
    expect(screen.getByRole('button', { name: 'action.cancel' })).toBeDefined();
  });

  it('second click (confirm) calls deleteOrganization with the org id', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'org-del-confirm', name: 'DeleteConfirm', slug: 'del-confirm' })]),
    );
    renderPage();

    // Both clicks use the same aria-label ('platform.orgs.delete');
    // first click arms confirm, second click fires mutation.
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.delete' }));
    expect(deleteOrgMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.delete' }));
    expect(deleteOrgMutateAsync).toHaveBeenCalledWith('org-del-confirm');
  });

  it('Cancel button cancels the delete confirm', () => {
    mq.useOrganizations.mockReturnValue(
      orgsSuccess([mkOrg({ id: 'org-cancel', name: 'CancelOrg', slug: 'cancel' })]),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'platform.orgs.delete' }));
    // Cancel button (action.cancel) should now appear alongside the confirm button
    expect(screen.getByRole('button', { name: 'action.cancel' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'action.cancel' }));
    // After cancelling, the action.cancel button should be gone
    expect(screen.queryByRole('button', { name: 'action.cancel' })).toBeNull();
    expect(deleteOrgMutateAsync).not.toHaveBeenCalled();
  });
});
