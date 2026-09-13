// ---------------------------------------------------------------------------
// ModelStudioPage tests
//
// The Studio is a 4-step wizard: Source → Inspect → Preview → Deploy.
// We cover the main state-machine transitions, the import flow, and the
// deploy / import-only outcomes. Because the page is 1026 lines we focus
// on: initial render, HF import path, catalog select path, preview outcomes,
// deploy/import-only actions. We skip node-detail rendering minutiae.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ModelStudioPage } from './ModelStudioPage';
import type { CatalogEntry, Deployment, ModelSpec, PlanPreviewResult } from '../api/types';

// ---------------------------------------------------------------------------
// Mock i18n — key passthrough
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
  useDeployModel: vi.fn(),
  useImportModel: vi.fn(),
  usePreviewModelPlan: vi.fn(),
  useNodes: vi.fn(),
}));

import {
  useCatalog,
  useDeployModel,
  useImportModel,
  usePreviewModelPlan,
  useNodes,
} from '../hooks/queries';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const modelSpec: ModelSpec = {
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
    { name: 'Q8_0', sizeGb: 9, requiresFp4: false, quality: 0.98, emulatedFp4: false },
  ],
  engine: 'llama.cpp',
};

const catalogEntry: CatalogEntry = {
  model: modelSpec,
  fit: {
    fits: true,
    quantization: 'Q4_K_M',
    nodesNeeded: 1,
    estimated: { decodeTokSMin: 30, decodeTokSMax: 50, prefillTokSMin: 100, prefillTokSMax: 200, headroomGb: 2 },
    deficitGb: 0,
    reasonKey: 'fits',
  },
};

const feasiblePreview: PlanPreviewResult = {
  feasible: true,
  plan: {
    planId: 'plan-001',
    modelId: 'llama-8b',
    quantization: 'Q4_K_M',
    assignments: [{ nodeId: 'node-gpu-01', role: 'host', layerStart: 0, layerEnd: 31, draft: false }],
    pipelineOrder: ['node-gpu-01'],
    estimated: { decodeTokSMin: 30, decodeTokSMax: 50, prefillTokSMin: 100, prefillTokSMax: 200, headroomGb: 2 },
    cost: 1.0,
    explanation: ['Fits on a single node'],
  },
};

const infeasiblePreview: PlanPreviewResult = {
  feasible: false,
  reason: 'Insufficient VRAM: need 80 GB, fleet has 24 GB',
};

// Mutation stubs
function idleMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false, isError: false, isSuccess: false,
    data: undefined, error: null, reset: vi.fn(),
  };
}

function mockDeployDeployment(): Deployment {
  return {
    id: 'dep-001',
    plan: feasiblePreview.plan!,
    state: 'provisioning',
    nodeStatus: [],
    createdAt: '2026-09-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

function defaultHooks() {
  vi.mocked(useCatalog).mockReturnValue({
    data: [catalogEntry], isLoading: false, isError: false, error: null, refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCatalog>);

  vi.mocked(useImportModel).mockReturnValue(idleMutation() as unknown as ReturnType<typeof useImportModel>);
  vi.mocked(usePreviewModelPlan).mockReturnValue(idleMutation() as unknown as ReturnType<typeof usePreviewModelPlan>);
  vi.mocked(useDeployModel).mockReturnValue(idleMutation() as unknown as ReturnType<typeof useDeployModel>);

  vi.mocked(useNodes).mockReturnValue({
    data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
  } as unknown as ReturnType<typeof useNodes>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ModelStudioPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelStudioPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultHooks();
  });

  // --- Initial render / stepper -----------------------------------------------

  it('renders the Model Studio page heading', () => {
    renderPage();
    expect(screen.getByText('studio.title')).toBeInTheDocument();
  });

  it('renders the 4-step progress stepper', () => {
    renderPage();
    expect(screen.getByRole('list', { name: /progress/i })).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem');
    // At minimum the 4 steps are rendered
    const stepLabels = steps.map(s => s.textContent);
    expect(stepLabels.join(' ')).toMatch(/Source/);
    expect(stepLabels.join(' ')).toMatch(/Inspect/);
    expect(stepLabels.join(' ')).toMatch(/Preview/);
    expect(stepLabels.join(' ')).toMatch(/Deploy/);
  });

  it('renders source type tabs (HuggingFace, Object Storage, SageMaker, …)', () => {
    renderPage();
    expect(screen.getByText('studio.source.huggingface')).toBeInTheDocument();
    expect(screen.getByText('studio.source.catalog')).toBeInTheDocument();
  });

  it('renders HuggingFace form fields by default', () => {
    renderPage();
    // HF form has repo/revision/filename fields
    expect(screen.getByText('studio.hf.repo')).toBeInTheDocument();
  });

  // --- HuggingFace import path ------------------------------------------------

  it('inspect button is disabled when HF repo is empty', () => {
    renderPage();
    const inspectBtn = screen.getByRole('button', { name: /studio.action.inspect/i });
    expect(inspectBtn).toBeDisabled();
  });

  it('inspect button is enabled after typing a HF repo', async () => {
    const user = userEvent.setup();
    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');

    const inspectBtn = screen.getByRole('button', { name: /studio.action.inspect/i });
    expect(inspectBtn).not.toBeDisabled();
  });

  it('calls importModel mutation when inspect clicked with a valid HF repo', async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn();
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');

    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'huggingface', repo: 'meta-llama/Llama-3.1-8B' }),
      expect.any(Object),
    );
  });

  it('shows model info card after successful import', async () => {
    const user = userEvent.setup();

    // Simulate importMutation.onSuccess calling setModel
    const mutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));

    await waitFor(() => {
      expect(screen.getByText('Llama 3.1 8B')).toBeInTheDocument();
    });
    // Model id also shown
    expect(screen.getByText('llama-8b')).toBeInTheDocument();
    // Step 2: model info card header
    expect(screen.getByText('studio.model.title')).toBeInTheDocument();
  });

  it('shows import error when importModel fails', async () => {
    const user = userEvent.setup();
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error('HF repo not found'),
    } as unknown as ReturnType<typeof useImportModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'bad/repo');
    // errorMessage(plain Error, t, 'error.import') returns t('error.import') = 'error.import'
    expect(screen.getByText('error.import')).toBeInTheDocument();
  });

  // --- Catalog source path ---------------------------------------------------

  it('hides external-source inspect block when Catalog tab selected', async () => {
    const user = userEvent.setup();
    renderPage();

    // Click the Catalog tab button in the tab bar
    await user.click(screen.getByText('studio.source.catalog'));

    // Wait for the HF form to disappear (confirms state updated to catalog source)
    await waitFor(() => {
      expect(screen.queryByText('studio.hf.repo')).toBeNull();
    });
    // The studio-import-callout is only inside the external-source actions block.
    // When catalog is active that block is hidden — CatalogPicker renders its own
    // inspect/select button separately, but the external-source wrapper is gone.
    expect(document.querySelector('[data-testid="studio-import-callout"]')).toBeNull();
    // Catalog picker's own select is now visible
    expect(screen.getByText('studio.catalog.select')).toBeInTheDocument();
  });

  // --- Preview step ----------------------------------------------------------

  it('shows preview plan button after model is loaded', async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /studio.preview.compute/i })).toBeInTheDocument();
    });
  });

  it('calls previewModelPlan with model id when preview button clicked', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: importMutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn();
    vi.mocked(usePreviewModelPlan).mockReturnValue({
      ...idleMutation(),
      mutate: previewMutateMock,
    } as unknown as ReturnType<typeof usePreviewModelPlan>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /studio.preview.compute/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));

    expect(previewMutateMock).toHaveBeenCalledWith('llama-8b', expect.any(Object));
  });

  it('shows feasible plan result with throughput', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: importMutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => {
      cbs.onSuccess(feasiblePreview);
    });
    vi.mocked(usePreviewModelPlan).mockReturnValue({
      ...idleMutation(),
      mutate: previewMutateMock,
    } as unknown as ReturnType<typeof usePreviewModelPlan>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));

    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));

    await waitFor(() => {
      // Feasible plan: throughput range
      expect(screen.getByText(/30.+50.+tok\/s/)).toBeInTheDocument();
    });
  });

  it('shows infeasible plan reason', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({
      ...idleMutation(),
      mutate: importMutateMock,
    } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => {
      cbs.onSuccess(infeasiblePreview);
    });
    vi.mocked(usePreviewModelPlan).mockReturnValue({
      ...idleMutation(),
      mutate: previewMutateMock,
    } as unknown as ReturnType<typeof usePreviewModelPlan>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));

    await waitFor(() => {
      expect(screen.getByText(/Insufficient VRAM/)).toBeInTheDocument();
    });
    // Deploy step should NOT appear for infeasible result
    expect(screen.queryByRole('button', { name: /studio.action.deploy/i })).toBeNull();
  });

  // --- Deploy step -----------------------------------------------------------

  it('shows deploy button after feasible plan', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => {
      cbs.onSuccess(modelSpec);
    });
    vi.mocked(useImportModel).mockReturnValue({ ...idleMutation(), mutate: importMutateMock } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => {
      cbs.onSuccess(feasiblePreview);
    });
    vi.mocked(usePreviewModelPlan).mockReturnValue({ ...idleMutation(), mutate: previewMutateMock } as unknown as ReturnType<typeof usePreviewModelPlan>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /studio.action.deploy/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /studio.action.importOnly/i })).toBeInTheDocument();
  });

  it('calls deployModel when deploy button clicked', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => { cbs.onSuccess(modelSpec); });
    vi.mocked(useImportModel).mockReturnValue({ ...idleMutation(), mutate: importMutateMock } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => { cbs.onSuccess(feasiblePreview); });
    vi.mocked(usePreviewModelPlan).mockReturnValue({ ...idleMutation(), mutate: previewMutateMock } as unknown as ReturnType<typeof usePreviewModelPlan>);

    const deployMutateMock = vi.fn();
    vi.mocked(useDeployModel).mockReturnValue({ ...idleMutation(), mutate: deployMutateMock } as unknown as ReturnType<typeof useDeployModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.action.deploy/i }));
    await user.click(screen.getByRole('button', { name: /studio.action.deploy/i }));

    expect(deployMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'llama-8b' }),
      expect.any(Object),
    );
  });

  it('shows deploy success toast when deployModel succeeds', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => { cbs.onSuccess(modelSpec); });
    vi.mocked(useImportModel).mockReturnValue({ ...idleMutation(), mutate: importMutateMock } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => { cbs.onSuccess(feasiblePreview); });
    vi.mocked(usePreviewModelPlan).mockReturnValue({ ...idleMutation(), mutate: previewMutateMock } as unknown as ReturnType<typeof usePreviewModelPlan>);

    const deployMutateMock = vi.fn().mockImplementation((_req: unknown, cbs: { onSuccess: (d: Deployment) => void }) => { cbs.onSuccess(mockDeployDeployment()); });
    vi.mocked(useDeployModel).mockReturnValue({ ...idleMutation(), mutate: deployMutateMock } as unknown as ReturnType<typeof useDeployModel>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.action.deploy/i }));
    await user.click(screen.getByRole('button', { name: /studio.action.deploy/i }));

    // Toast shows success
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByText('studio.deployed.title')).toBeInTheDocument();
  });

  it('shows imported toast when import-only button clicked', async () => {
    const user = userEvent.setup();

    const importMutateMock = vi.fn().mockImplementation((_src: unknown, cbs: { onSuccess: (m: ModelSpec) => void }) => { cbs.onSuccess(modelSpec); });
    vi.mocked(useImportModel).mockReturnValue({ ...idleMutation(), mutate: importMutateMock } as unknown as ReturnType<typeof useImportModel>);

    const previewMutateMock = vi.fn().mockImplementation((_id: unknown, cbs: { onSuccess: (r: PlanPreviewResult) => void }) => { cbs.onSuccess(feasiblePreview); });
    vi.mocked(usePreviewModelPlan).mockReturnValue({ ...idleMutation(), mutate: previewMutateMock } as unknown as ReturnType<typeof usePreviewModelPlan>);

    renderPage();

    const repoInput = screen.getByPlaceholderText('studio.hf.repo.placeholder');
    await user.type(repoInput, 'meta-llama/Llama-3.1-8B');
    await user.click(screen.getByRole('button', { name: /studio.action.inspect/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.preview.compute/i }));
    await user.click(screen.getByRole('button', { name: /studio.preview.compute/i }));
    await waitFor(() => screen.getByRole('button', { name: /studio.action.importOnly/i }));
    await user.click(screen.getByRole('button', { name: /studio.action.importOnly/i }));

    await waitFor(() => {
      expect(screen.getByText('studio.imported.title')).toBeInTheDocument();
    });
  });

  // --- Import-related info callout --------------------------------------------

  it('shows the metadata-only info callout for external sources', () => {
    renderPage();
    const callout = screen.getByTestId('studio-import-callout');
    expect(callout).toBeInTheDocument();
    expect(callout.textContent).toContain('studio.import.infoCallout');
  });
});
