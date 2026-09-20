// ---------------------------------------------------------------------------
// ConfigCodePage tests
//
// Three operations: export (read-only code panel), diff (dry-run), apply
// (mutating, gated behind an arm → confirm modal).
//
// Mocks: useConfigExport, useConfigDiff, useConfigApply from hooks/queries.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigCodePage } from './ConfigCodePage';
import type { ConfigApplyResult, ConfigDiff } from '../api/types';

// ---------------------------------------------------------------------------
// Mock i18n
// ---------------------------------------------------------------------------
vi.mock('../i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Mock hooks/queries
// ---------------------------------------------------------------------------
vi.mock('../hooks/queries', () => ({
  useConfigExport: vi.fn(),
  useConfigDiff: vi.fn(),
  useConfigApply: vi.fn(),
}));

import { useConfigExport, useConfigDiff, useConfigApply } from '../hooks/queries';
const mockUseConfigExport = vi.mocked(useConfigExport);
const mockUseConfigDiff = vi.mocked(useConfigDiff);
const mockUseConfigApply = vi.mocked(useConfigApply);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleYaml = 'apiVersion: purser/v1\nkind: ClusterConfig\n';

const sampleDiff: ConfigDiff = {
  modelsToAdd: ['llama-8b'],
  modelsToRemove: [],
  deploymentsToAdd: [],
  deploymentsToRemove: ['old-dep'],
  quotasToUpsert: [],
};

const noopDiff: ConfigDiff = {
  modelsToAdd: [],
  modelsToRemove: [],
  deploymentsToAdd: [],
  deploymentsToRemove: [],
  quotasToUpsert: [],
};

const applyResult: ConfigApplyResult = {
  modelsAdded: 2,
  deploymentsAdded: 1,
  orgsAdded: 0,
  nodePoolsAdded: 0,
  quotasUpserted: 3,
  slosUpserted: 0,
};

function idleMutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    data: undefined,
    error: null,
    reset: vi.fn(),
  };
}

function defaultHooks() {
  mockUseConfigExport.mockReturnValue({
    data: sampleYaml,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useConfigExport>);
  mockUseConfigDiff.mockReturnValue(idleMutation() as unknown as ReturnType<typeof useConfigDiff>);
  mockUseConfigApply.mockReturnValue(idleMutation() as unknown as ReturnType<typeof useConfigApply>);
}

function renderPage() {
  return render(<ConfigCodePage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigCodePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultHooks();
  });

  // --- Page basics ----------------------------------------------------------

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('configcode.title')).toBeInTheDocument();
  });

  it('renders the current config code panel with export content', () => {
    renderPage();
    // CodePanel splits YAML line-by-line; first line appears in the table
    expect(screen.getByText('apiVersion: purser/v1')).toBeInTheDocument();
  });

  // --- Export loading / error states ----------------------------------------

  it('renders without crashing while export is loading', () => {
    mockUseConfigExport.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useConfigExport>);
    expect(() => renderPage()).not.toThrow();
  });

  it('shows error state with retry when export fails', () => {
    const refetch = vi.fn();
    mockUseConfigExport.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('export failed'), refetch,
    } as unknown as ReturnType<typeof useConfigExport>);
    renderPage();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  // --- Editor & action buttons ----------------------------------------------

  it('"Load current" button is enabled when export data is available', () => {
    renderPage();
    const loadBtn = screen.getByRole('button', { name: /configcode.action.loadCurrent/i });
    expect(loadBtn).not.toBeDisabled();
  });

  it('"Load current" button is disabled when export data is not yet available', () => {
    mockUseConfigExport.mockReturnValue({
      data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useConfigExport>);
    renderPage();
    const loadBtn = screen.getByRole('button', { name: /configcode.action.loadCurrent/i });
    expect(loadBtn).toBeDisabled();
  });

  it('clicking "Load current" populates editor textarea with export data', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /configcode.action.loadCurrent/i }));
    const textarea = screen.getByRole('textbox', { name: /configcode.editor.label/i });
    expect((textarea as HTMLTextAreaElement).value).toContain('apiVersion: purser/v1');
  });

  it('diff button is disabled when editor is empty', () => {
    renderPage();
    const diffBtn = screen.getByRole('button', { name: 'configcode.action.diff' });
    expect(diffBtn).toBeDisabled();
  });

  it('apply button is disabled when editor is empty', () => {
    renderPage();
    const applyBtn = screen.getByRole('button', { name: 'configcode.action.apply' });
    expect(applyBtn).toBeDisabled();
  });

  it('diff and apply buttons enable after typing in the editor', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = screen.getByRole('textbox', { name: /configcode.editor.label/i });
    await user.type(textarea, 'apiVersion: purser/v1');
    expect(screen.getByRole('button', { name: 'configcode.action.diff' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'configcode.action.apply' })).not.toBeDisabled();
  });

  // --- Diff flow -----------------------------------------------------------

  it('calls diff mutate with editor content when diff button clicked', async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn();
    mockUseConfigDiff.mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useConfigDiff>);
    renderPage();
    // Load current YAML to populate editor
    await user.click(screen.getByRole('button', { name: /configcode.action.loadCurrent/i }));
    await user.click(screen.getByRole('button', { name: 'configcode.action.diff' }));
    expect(mutateMock).toHaveBeenCalledWith(sampleYaml);
  });

  it('shows diff result when diff succeeds with changes', () => {
    mockUseConfigDiff.mockReturnValue({
      ...idleMutation(),
      data: sampleDiff,
    } as unknown as ReturnType<typeof useConfigDiff>);
    renderPage();
    expect(screen.getByTestId('config-diff-result')).toBeInTheDocument();
    // modelsToAdd has 'llama-8b'
    expect(screen.getByText('llama-8b')).toBeInTheDocument();
  });

  it('shows "no changes" badge when diff result is empty', () => {
    mockUseConfigDiff.mockReturnValue({
      ...idleMutation(),
      data: noopDiff,
    } as unknown as ReturnType<typeof useConfigDiff>);
    renderPage();
    expect(screen.getByText('configcode.diff.noChanges')).toBeInTheDocument();
  });

  it('shows error state when diff fails', () => {
    mockUseConfigDiff.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error('diff error'),
    } as unknown as ReturnType<typeof useConfigDiff>);
    renderPage();
    expect(screen.getByText('configcode.error.diffTitle')).toBeInTheDocument();
  });

  // --- Apply flow (arm → confirm modal) -----------------------------------

  it('opens confirm modal when apply button clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    // Load current YAML to enable apply button
    await user.click(screen.getByRole('button', { name: /configcode.action.loadCurrent/i }));
    await user.click(screen.getByRole('button', { name: 'configcode.action.apply' }));
    expect(screen.getByText('configcode.confirm.title')).toBeInTheDocument();
  });

  it('cancel button in the confirm modal closes it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /configcode.action.loadCurrent/i }));
    await user.click(screen.getByRole('button', { name: 'configcode.action.apply' }));
    await user.click(screen.getByRole('button', { name: 'action.cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('configcode.confirm.title')).toBeNull();
    });
  });

  it('calls apply mutate with editor content when confirm button clicked', async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn();
    mockUseConfigApply.mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useConfigApply>);
    renderPage();
    await user.click(screen.getByRole('button', { name: /configcode.action.loadCurrent/i }));
    await user.click(screen.getByRole('button', { name: 'configcode.action.apply' }));
    await user.click(screen.getByRole('button', { name: 'configcode.confirm.apply' }));
    expect(mutateMock).toHaveBeenCalledWith(sampleYaml);
  });

  it('shows apply result with stats when apply succeeds', () => {
    mockUseConfigApply.mockReturnValue({
      ...idleMutation(),
      data: applyResult,
    } as unknown as ReturnType<typeof useConfigApply>);
    renderPage();
    const resultEl = screen.getByTestId('config-apply-result');
    expect(resultEl).toBeInTheDocument();
    // modelsAdded = 2; scope query to result block to avoid matching line numbers in CodePanel
    expect(within(resultEl).getByText('2')).toBeInTheDocument();
  });

  it('shows error state when apply fails', () => {
    mockUseConfigApply.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error('apply error'),
    } as unknown as ReturnType<typeof useConfigApply>);
    renderPage();
    expect(screen.getByText('configcode.error.applyTitle')).toBeInTheDocument();
  });
});
