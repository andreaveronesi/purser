// ---------------------------------------------------------------------------
// Unit tests for client.ts — mock-mode path.
//
// The module-level `const mock = config.mock ? await import('../mock/wiring') : null`
// and the `if (mock)` branch in `makeChat` require `config.mock === true`.
// We use vi.mock() (hoisted before imports) + vi.resetModules() + dynamic import
// to exercise those branches in isolation.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock() calls are hoisted before any imports — they take effect before client.ts loads.
vi.mock('../config', () => ({
  config: {
    mock: true,
    apiBase: '/api/v1',
    gatewayBase: '/v1',
    oidc: null,
  },
}));

const mockStream = vi.fn();
const mockListModels = vi.fn().mockResolvedValue([
  { id: 'mock-llama3', object: 'model', ownedBy: 'purser' },
]);

vi.mock('../../mock/wiring', () => ({
  // mockBackend is what client.ts assigns to `api` in mock mode.
  mockBackend: { _isMockBackend: true, getCapacity: vi.fn() },
  // mockChatTransport is used by makeChat in mock mode.
  mockChatTransport: { stream: mockStream },
  // mockListModels is used by makeChat in mock mode.
  mockListModels,
}));

beforeEach(() => {
  vi.resetModules();
});

describe('client.ts — mock mode (config.mock=true)', () => {
  it('api is the mockBackend when mock mode is enabled (L378 truthy branch)', async () => {
    // Fresh import after resetModules — client.ts evaluates with config.mock=true.
    const { api } = await import('../client');
    // With mock=true, api === mock.mockBackend === { _isMockBackend: true, ... }
    expect((api as unknown as Record<string, unknown>)._isMockBackend).toBe(true);
  });

  it('makeChat returns a client backed by mockChatTransport (L391-396 branch)', async () => {
    const { makeChat } = await import('../client');
    const client = makeChat('sk-test');
    // The base URL should still be the configured gatewayBase.
    expect(client.baseUrl).toBe('/v1');
    // listModels should delegate to mockListModels.
    const models = await client.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('mock-llama3');
  });

  it('makeChat without apiKey also works in mock mode', async () => {
    const { makeChat } = await import('../client');
    const client = makeChat();
    expect(client).toBeDefined();
    expect(client.baseUrl).toBe('/v1');
  });

  it('streamChat in mock mode delegates to mockChatTransport.stream', async () => {
    const { makeChat } = await import('../client');
    const client = makeChat('sk-mock');
    const handlers = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    client.streamChat({ model: 'mock-llama3', messages: [] }, handlers);
    expect(mockStream).toHaveBeenCalled();
  });
});
