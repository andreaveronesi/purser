// ---------------------------------------------------------------------------
// PlaygroundPage tests
//
// The PlaygroundPage is a chat UI. It uses:
//  - useDeployments: list of active deployments (for fallback model list)
//  - useGatewayModels(chat): live list from the Gateway's /v1/models endpoint
//  - makeChat(apiKey): builds the ChatClient used for streaming
//
// Key behaviours covered:
//  - Model picker defaults to DEFAULT_MODEL when no data yet
//  - De-duplicates gateway models (issue fixed in recent commit)
//  - "No deployment" notice when deployments loaded but none active
//  - Send button disabled when input is empty
//  - Clear button disabled when no messages
//  - Sends a message and invokes chat.streamChat with correct args
//  - Shows error token in chat when streamChat fires onError
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PlaygroundPage } from './PlaygroundPage';
import type { Deployment } from '../api/types';

// jsdom does not implement HTMLElement.scrollTo — stub it once for the file.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

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
  useDeployments: vi.fn(),
  useGatewayModels: vi.fn(),
}));

import { useDeployments, useGatewayModels } from '../hooks/queries';
const mockUseDeployments = vi.mocked(useDeployments);
const mockUseGatewayModels = vi.mocked(useGatewayModels);

// ---------------------------------------------------------------------------
// Mock api/client — makeChat returns a deterministic stub
// ---------------------------------------------------------------------------
const streamChatMock = vi.fn();
const mockChatClient = {
  baseUrl: 'http://localhost:8081',
  streamChat: streamChatMock,
  listModels: vi.fn().mockResolvedValue([]),
};

vi.mock('../api/client', () => ({
  makeChat: vi.fn(() => mockChatClient),
  chat: {
    baseUrl: 'http://localhost:8081',
    streamChat: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const activeDeployment: Deployment = {
  id: 'dep-1',
  state: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  plan: {
    planId: 'plan-1',
    modelId: 'llama-8b',
    quantization: 'Q4_K_M',
    assignments: [],
    pipelineOrder: [],
    estimated: { decodeTokSMin: 30, decodeTokSMax: 50, prefillTokSMin: 100, prefillTokSMax: 200, headroomGb: 2 },
    cost: 1.0,
    explanation: [],
  },
  nodeStatus: [],
};

function defaultHooks() {
  mockUseDeployments.mockReturnValue({
    data: [activeDeployment],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDeployments>);

  mockUseGatewayModels.mockReturnValue({
    data: [{ id: 'llama-8b' }, { id: 'mistral-7b' }],
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useGatewayModels>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaygroundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset streamChatMock between tests
    streamChatMock.mockReset();
    defaultHooks();
  });

  // --- Page basics -----------------------------------------------------------

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('playground.title')).toBeInTheDocument();
  });

  it('renders the chat log area', () => {
    renderPage();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('renders the send button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /playground\.send/i })).toBeInTheDocument();
  });

  // --- Model picker ---------------------------------------------------------

  it('shows gateway models in the model picker', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('llama-8b');
    expect(options).toContain('mistral-7b');
  });

  it('de-duplicates models when both gateway and deployments supply the same id', () => {
    // Gateway returns one model; deployment also has the same model
    mockUseGatewayModels.mockReturnValue({
      data: [{ id: 'llama-8b' }],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i });
    const opts = Array.from((select as HTMLSelectElement).options).filter((o) => o.value === 'llama-8b');
    // Must appear exactly once
    expect(opts.length).toBe(1);
  });

  it('falls back to deployment model list when gateway models unavailable', () => {
    mockUseGatewayModels.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    // Falls back to active deployment model
    expect(options).toContain('llama-8b');
  });

  // --- No-deployment notice -------------------------------------------------

  it('shows no-deployment notice when deployments loaded but empty', () => {
    mockUseDeployments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);
    // Gateway also empty to trigger the notice path
    mockUseGatewayModels.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
    renderPage();
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/playground\.noDeployment/)).toBeInTheDocument();
  });

  it('no-deployment notice contains a link to /catalog', () => {
    mockUseDeployments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);
    mockUseGatewayModels.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
    renderPage();
    const catalogLink = screen.getByRole('link', { name: /nav\.catalog/i });
    expect(catalogLink).toHaveAttribute('href', '/catalog');
  });

  // --- Send button / input --------------------------------------------------

  it('send button is disabled when input is empty', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /playground\.send/i })).toBeDisabled();
  });

  it('send button enables after typing in the input', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    expect(screen.getByRole('button', { name: /playground\.send/i })).not.toBeDisabled();
  });

  // --- Clear button ---------------------------------------------------------

  it('clear button is disabled when chat is empty', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /playground\.clear/i })).toBeDisabled();
  });

  // --- Sending a message ----------------------------------------------------

  it('calls chat.streamChat when send button clicked', async () => {
    const user = userEvent.setup();
    // Make streamChat complete immediately
    streamChatMock.mockImplementation(
      (_req: unknown, handlers: { onDone: () => void }) => { handlers.onDone(); }
    );
    renderPage();
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'What models do you have?');
    await user.click(screen.getByRole('button', { name: /playground\.send/i }));
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'What models do you have?' }),
        ]),
        stream: true,
      }),
      expect.objectContaining({ onToken: expect.any(Function), onDone: expect.any(Function) }),
    );
  });

  it('shows user message in chat log after sending', async () => {
    const user = userEvent.setup();
    streamChatMock.mockImplementation(
      (_req: unknown, handlers: { onDone: () => void }) => { handlers.onDone(); }
    );
    renderPage();
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello bot');
    await user.click(screen.getByRole('button', { name: /playground\.send/i }));
    await waitFor(() => {
      expect(screen.getByText('Hello bot')).toBeInTheDocument();
    });
  });

  it('shows error token in assistant bubble when streamChat fires onError', async () => {
    const user = userEvent.setup();
    streamChatMock.mockImplementation(
      (_req: unknown, handlers: { onError: () => void }) => { handlers.onError(); }
    );
    renderPage();
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Trigger error');
    await user.click(screen.getByRole('button', { name: /playground\.send/i }));
    await waitFor(() => {
      // Error message prepends ⚠️ + playground.error key
      expect(screen.getByText(/playground\.error/)).toBeInTheDocument();
    });
  });

  // --- API key field --------------------------------------------------------

  it('renders API key field', () => {
    renderPage();
    // The field is a password input; its label is 'playground.apikey'
    expect(screen.getByText('playground.apikey')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phantom-model bug (E5): no models available → disabled/placeholder state
// ---------------------------------------------------------------------------

describe('PlaygroundPage — no models state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamChatMock.mockReset();
    // Both gateway and deployments empty → activeModels = []
    mockUseDeployments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);
    mockUseGatewayModels.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
  });

  it('selector does NOT contain qwen3-moe-235b when no models available', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).not.toContain('qwen3-moe-235b');
  });

  it('selector shows playground.noModels placeholder when no models available', () => {
    renderPage();
    expect(screen.getByText('playground.noModels')).toBeInTheDocument();
  });

  it('Send button is disabled when no models available', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /playground\.send/i })).toBeDisabled();
  });

  it('textarea is disabled when no models available', () => {
    renderPage();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// E5: with active model → normal usable state
// ---------------------------------------------------------------------------

describe('PlaygroundPage — with active model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamChatMock.mockReset();
    mockUseDeployments.mockReturnValue({
      data: [activeDeployment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDeployments>);
    mockUseGatewayModels.mockReturnValue({
      data: [{ id: 'tinyllama-1b' }],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGatewayModels>);
  });

  it('selector contains the real model (tinyllama-1b)', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('tinyllama-1b');
  });

  it('model state is initialized to the first real model, not the phantom', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: /playground\.model/i }) as HTMLSelectElement;
    expect(select.value).toBe('tinyllama-1b');
    expect(select.value).not.toBe('qwen3-moe-235b');
  });

  it('Send button is enabled after typing when model is available', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = screen.getByRole('textbox');
    expect(textarea).not.toBeDisabled();
    await user.type(textarea, 'Hello');
    expect(screen.getByRole('button', { name: /playground\.send/i })).not.toBeDisabled();
  });
});
