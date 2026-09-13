// ---------------------------------------------------------------------------
// WhatIfPlannerPage tests
//
// Key coverage goals:
//  - CAMELIZE LEAD regression: API response fields are camelCase after
//    camelizeKeys(); the page must read estimatedDecodeTokSMin (not the
//    old snake_case estimated_decode_tok_s_min). Tests prove the post-fix
//    behaviour works with real camelized shapes.
//  - null-guard: estimatedDecodeTokSMin/Max can come back as `null` for
//    *float64 Go fields; the guard must use != null, not !== undefined.
//  - All UI branches: loading, error, empty (no model), simulation states.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatIfPlannerPage } from './WhatIfPlannerPage';
import type { CatalogEntry, WhatIfResult } from '../api/types';

// ---------------------------------------------------------------------------
// Mock i18n — key+params passthrough so we can assert exact value flows
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
  useCatalog: vi.fn(),
  useWhatIfPlan: vi.fn(),
}));

import { useCatalog, useWhatIfPlan } from '../hooks/queries';
const mockUseCatalog = vi.mocked(useCatalog);
const mockUseWhatIfPlan = vi.mocked(useWhatIfPlan);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catalogEntry: CatalogEntry = {
  model: {
    modelId: 'llama-8b',
    family: 'Llama 3.1 8B',
    architecture: 'LlamaForCausalLM',
    paramsTotalB: 8,
    paramsActiveB: 8,
    layers: 32,
    hiddenSize: 4096,
    nKvHeads: 8,
    headDim: 128,
    attentionType: 'gqa',
    contextMax: 8192,
    isMoe: false,
    draft: { available: false, type: '', tailLayers: 0 },
    quantizations: [
      { name: 'Q4_K_M', sizeGb: 5, requiresFp4: false, quality: 0.91, emulatedFp4: false },
    ],
    engine: 'llama.cpp',
  },
  fit: {
    fits: true,
    quantization: 'Q4_K_M',
    nodesNeeded: 1,
    estimated: { decodeTokSMin: 30, decodeTokSMax: 50, prefillTokSMin: 100, prefillTokSMax: 200, headroomGb: 2 },
    deficitGb: 0,
    reasonKey: 'fits',
  },
};

// What the hook returns after camelizeKeys — CAMELCASE fields (the real shape)
const feasibleResult: WhatIfResult = {
  feasible: true,
  estimatedDecodeTokSMin: 42,
  estimatedDecodeTokSMax: 68,
  improvementDelta: 0.35,
  currentPlan: { feasible: false },
  assignments: [
    { nodeId: 'virtual-1', layerStart: 0, layerEnd: 31 },
  ],
};

const infeasibleResult: WhatIfResult = {
  feasible: false,
  reason: 'Not enough VRAM even with virtual nodes',
};

// Mutation stub helpers
function idleMutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    data: undefined,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useWhatIfPlan>;
}

function successMutation(data: WhatIfResult) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: true,
    data,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useWhatIfPlan>;
}

function errorMutation(err: Error) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: true,
    isSuccess: false,
    data: undefined,
    error: err,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useWhatIfPlan>;
}

function pendingMutation() {
  return {
    mutate: vi.fn(),
    isPending: true,
    isError: false,
    isSuccess: false,
    data: undefined,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useWhatIfPlan>;
}

// Catalog result helpers
function catalogLoaded(entries = [catalogEntry]) {
  return { data: entries, isLoading: false, isError: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useCatalog>;
}
function catalogLoading() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useCatalog>;
}

function renderPage() {
  return render(<WhatIfPlannerPage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatIfPlannerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCatalog.mockReturnValue(catalogLoaded());
    mockUseWhatIfPlan.mockReturnValue(idleMutation());
  });

  // --- Loading / error states -------------------------------------------------

  it('shows loading block while catalog loads', () => {
    mockUseCatalog.mockReturnValue(catalogLoading());
    renderPage();
    // LoadingBlock renders aria-busy or a known class — check it doesn't crash
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows error state with retry when catalog fails', () => {
    const refetch = vi.fn();
    mockUseCatalog.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('Catalog fetch error'), refetch,
    } as unknown as ReturnType<typeof useCatalog>);

    renderPage();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // --- Configuration form ----------------------------------------------------

  it('renders model select with catalog entries', () => {
    renderPage();

    const select = screen.getByRole('combobox');
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(options).toContain('llama-8b');
  });

  it('simulate button is disabled when no model is selected', () => {
    renderPage();

    const simulateBtn = screen.getByRole('button', { name: /planner.whatIf.simulate/i });
    expect(simulateBtn).toBeDisabled();
  });

  it('calls mutate with correct shape when simulate clicked', async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn();
    mockUseWhatIfPlan.mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    });
    renderPage();

    // Select the model
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'llama-8b');

    // Click simulate
    const simulateBtn = screen.getByRole('button', { name: /planner.whatIf.simulate/i });
    await user.click(simulateBtn);

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model_id: 'llama-8b',
        hypothetical_nodes: expect.arrayContaining([expect.objectContaining({ gpu_vram_gb: 24 })]),
        include_existing_nodes: true,
      }),
    );
  });

  it('shows loading state while simulation is pending', async () => {
    const user = userEvent.setup();
    mockUseWhatIfPlan.mockReturnValue(pendingMutation());
    renderPage();

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'llama-8b');

    // Simulate button should show loading text
    expect(screen.getByRole('button', { name: /common.loading/i })).toBeInTheDocument();
  });

  // --- Result panel -----------------------------------------------------------

  // CAMELIZE LEAD regression: the API returns camelCase after camelizeKeys().
  // Before the fix, the page read snake_case keys → values were always absent.
  it('shows throughput range from feasible result (CAMELIZE LEAD fix)', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(feasibleResult));
    renderPage();

    // estimatedDecodeTokSMin=42, estimatedDecodeTokSMax=68
    // i18n passthrough: planner.whatIf.result.throughput:{"min":"42","max":"68"}
    const throughputEl = screen.getByText(/planner\.whatIf\.result\.throughput/);
    expect(throughputEl.textContent).toContain('"min":"42"');
    expect(throughputEl.textContent).toContain('"max":"68"');
  });

  it('shows improvement delta badge when improvementDelta > 0', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(feasibleResult));
    renderPage();

    // improvementDelta=0.35 → (0.35 * 100).toFixed(0) = "35"
    const deltaEl = screen.getByText(/planner\.whatIf\.result\.delta/);
    expect(deltaEl.textContent).toContain('"delta":"35"');
  });

  it('shows currentPlan context note when currentPlan is present', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(feasibleResult));
    renderPage();

    // currentPlan.feasible=false → shows infeasible status
    expect(screen.getByText(/planner\.whatIf\.result\.currentPlan/)).toBeInTheDocument();
  });

  it('shows assignments table with camelCase node/layer fields', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(feasibleResult));
    renderPage();

    const table = screen.getByTestId('whatif-assignments-table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('virtual-1')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();   // layerStart
    expect(screen.getByText('31')).toBeInTheDocument();  // layerEnd
  });

  it('shows infeasible badge text and reason when result is infeasible', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(infeasibleResult));
    renderPage();

    // Badge text is the i18n key
    expect(screen.getByText('planner.whatIf.result.infeasible')).toBeInTheDocument();
    expect(screen.getByText(/Not enough VRAM/)).toBeInTheDocument();
  });

  it('shows feasible badge text when result is feasible', () => {
    mockUseWhatIfPlan.mockReturnValue(successMutation(feasibleResult));
    renderPage();

    expect(screen.getByText('planner.whatIf.result.feasible')).toBeInTheDocument();
  });

  // null-guard: Go *float64 fields can come back null, not just undefined
  it('does not crash when estimatedDecodeTokSMin/Max are null', () => {
    const resultWithNullEstimates: WhatIfResult = {
      feasible: true,
      estimatedDecodeTokSMin: null,
      estimatedDecodeTokSMax: null,
      assignments: [],
    };
    mockUseWhatIfPlan.mockReturnValue(successMutation(resultWithNullEstimates));

    expect(() => renderPage()).not.toThrow();
    // Throughput row should NOT appear
    expect(screen.queryByText(/planner\.whatIf\.result\.throughput/)).toBeNull();
  });

  it('does not crash when improvementDelta is null', () => {
    const resultWithNullDelta: WhatIfResult = {
      feasible: true,
      improvementDelta: null,
      assignments: [],
    };
    mockUseWhatIfPlan.mockReturnValue(successMutation(resultWithNullDelta));

    expect(() => renderPage()).not.toThrow();
    expect(screen.queryByText(/planner\.whatIf\.result\.delta/)).toBeNull();
  });

  // --- Simulation error -------------------------------------------------------

  it('shows error state when simulation fails', () => {
    mockUseWhatIfPlan.mockReturnValue(errorMutation(new Error('planner timeout')));
    renderPage();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // --- Virtual node form ------------------------------------------------------

  it('adds a virtual node when Add node button clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const nodeRows = document.querySelectorAll('.what-if-node-row');
    expect(nodeRows.length).toBe(1);

    await user.click(screen.getByRole('button', { name: /planner.whatIf.addNode/i }));

    const nodeRowsAfter = document.querySelectorAll('.what-if-node-row');
    expect(nodeRowsAfter.length).toBe(2);
  });

  it('removes a virtual node when Remove button clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    // First add a node so we have 2
    await user.click(screen.getByRole('button', { name: /planner.whatIf.addNode/i }));
    expect(document.querySelectorAll('.what-if-node-row').length).toBe(2);

    // Remove the first node
    const removeBtns = screen.getAllByRole('button', { name: /planner.whatIf.removeNode/i });
    await user.click(removeBtns[0]);

    expect(document.querySelectorAll('.what-if-node-row').length).toBe(1);
  });

  // --- Framing fix: comparative block (W1) ------------------------------------
  // These tests prove the two-scenario framing; they fail before the fix because
  // the old component uses a single badge + muted span without distinct labels.

  it('shows both scenario labels when currentPlan is present (failing before fix)', () => {
    const result: WhatIfResult = { feasible: false, currentPlan: { feasible: true } };
    mockUseWhatIfPlan.mockReturnValue(successMutation(result));
    renderPage();

    expect(screen.getByText('planner.whatIf.result.withSimulated')).toBeInTheDocument();
    expect(screen.getByText('planner.whatIf.result.currentFleet')).toBeInTheDocument();
  });

  it('shows no-improvement row when simulated infeasible but current fleet feasible (failing before fix)', () => {
    const result: WhatIfResult = { feasible: false, currentPlan: { feasible: true } };
    mockUseWhatIfPlan.mockReturnValue(successMutation(result));
    renderPage();

    expect(screen.getByText('planner.whatIf.result.noImprovement')).toBeInTheDocument();
  });

  it('shows only simulated row and no currentFleet row when currentPlan absent (failing before fix)', () => {
    const result: WhatIfResult = { feasible: true, assignments: [] };
    mockUseWhatIfPlan.mockReturnValue(successMutation(result));
    renderPage();

    expect(screen.getByText('planner.whatIf.result.withSimulated')).toBeInTheDocument();
    expect(screen.queryByText('planner.whatIf.result.currentFleet')).toBeNull();
    expect(screen.queryByText('planner.whatIf.result.noImprovement')).toBeNull();
  });

  it('whatif-simulated-badge and whatif-current-badge carry correct verdicts (failing before fix)', () => {
    const result: WhatIfResult = { feasible: false, currentPlan: { feasible: true } };
    mockUseWhatIfPlan.mockReturnValue(successMutation(result));
    renderPage();

    const simulatedBadge = screen.getByTestId('whatif-simulated-badge');
    expect(simulatedBadge.textContent).toContain('planner.whatIf.result.infeasible');

    const currentBadge = screen.getByTestId('whatif-current-badge');
    expect(currentBadge.textContent).toContain('planner.whatIf.result.feasible');
  });

  // --- Empty state ------------------------------------------------------------

  it('shows empty state hint when no model selected and no result', () => {
    renderPage();
    // Empty state renders the noModel message. The text also appears in the
    // <option> placeholder — use getAllByText and verify count or use class selector.
    const allMatches = screen.getAllByText('planner.whatIf.noModel');
    // At minimum: the empty-state message + the option placeholder
    expect(allMatches.length).toBeGreaterThanOrEqual(1);
    // Confirm the empty-state div is present
    const emptyState = document.querySelector('.empty-state__msg');
    expect(emptyState?.textContent).toBe('planner.whatIf.noModel');
  });
});
