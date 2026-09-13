// ---------------------------------------------------------------------------
// Mutation killers for client.ts — non-mock (real) path.
//
// Two static mutants survive because client.mock-mode.test.ts loads client.ts
// with config.mock=true (so mock=mockWiring), making `if (mock)` and `if (true)`
// indistinguishable. These tests explicitly force config.mock=false via vi.mock
// and vi.resetModules() so the mutation's divergence is observable.
//
// Targets:
//   L390  ConditionalExpression → true  (`if (mock)` → `if (true)`)
//   L401  ObjectLiteral → {}            (`makeSseChatTransport({baseUrl, apiKey})` → `{}`)
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist: force config.mock=false so client.ts sets `mock = null` on every fresh import.
vi.mock('../config', () => ({
  config: {
    mock: false,
    apiBase: '/api/v1',
    gatewayBase: '/v1',
    oidc: null,
  },
}));

// Do NOT mock '../mock/wiring'. When config.mock=false, wiring is never imported.

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client.ts — real mode (config.mock=false)', () => {
  it('makeChat streamChat calls fetch at /v1/chat/completions (kills L390 if(true) mutation)', async () => {
    // With mutation `if (true)`: mock is null → null.mockChatTransport → TypeError → test fails.
    // With correct code `if (mock)`: mock is null → false → uses real SSE transport.
    const { makeChat } = await import('../client');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    } as unknown as Response);

    const client = makeChat('sk-real');
    await new Promise<void>((resolve) => {
      client.streamChat(
        { model: 'llama3', messages: [] },
        { onToken: vi.fn(), onDone: () => resolve(), onError: vi.fn() },
      );
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    // Verify the real SSE endpoint is called, not a mock stub.
    expect(fetchSpy.mock.calls[0][0]).toBe('/v1/chat/completions');
  });

  it('makeChat transport uses configured baseUrl and apiKey (kills L401 ObjectLiteral → {} mutation)', async () => {
    // Mutation: `makeSseChatTransport({ baseUrl: config.gatewayBase, apiKey })` → `{}`
    // With `{}`: opts.baseUrl=undefined → URL becomes "undefined/chat/completions" (wrong).
    //           opts.apiKey=undefined → Authorization header absent (wrong).
    const { makeChat } = await import('../client');

    const stream = new ReadableStream({ start(c) { c.close(); } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    } as unknown as Response);

    const client = makeChat('sk-transport-test');
    client.streamChat(
      { model: 'm', messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    // baseUrl must be '/v1' (from mocked config.gatewayBase), not 'undefined'
    expect(url).toBe('/v1/chat/completions');
    // apiKey must be forwarded as Authorization header
    const headers = opts?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer sk-transport-test');
  });
});
