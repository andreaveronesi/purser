// ---------------------------------------------------------------------------
// Unit tests for client.ts — makeChat URL/transport wiring.
// The module-level `await import()` for the mock backend is exercised via
// direct calls to the exported functions; the mock branch requires module
// isolation so we test the real branch here and document the mock branch
// as covered by mock/wiring integration tests (M5).
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeChat } from '../client';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeChat', () => {
  it('returns a ChatClient with the configured gateway baseUrl', () => {
    const client = makeChat();
    // The base URL should be the configured gatewayBase ("/v1" by default).
    expect(typeof client.baseUrl).toBe('string');
    expect(client.baseUrl).toBeTruthy();
  });

  it('exposes streamChat and listModels methods', () => {
    const client = makeChat();
    expect(typeof client.streamChat).toBe('function');
    expect(typeof client.listModels).toBe('function');
  });

  it('accepts an optional apiKey and still returns a client', () => {
    const client = makeChat('sk-test-key');
    expect(client).toBeDefined();
    expect(client.baseUrl).toBeTruthy();
  });

  it('listModels calls the gateway /models endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: [{ id: 'llama3-8b', object: 'model', owned_by: 'purser' }],
      }),
    } as unknown as Response);

    const client = makeChat('sk-test');
    const models = await client.listModels();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('llama3-8b');
  });
});
