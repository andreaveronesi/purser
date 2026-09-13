// ---------------------------------------------------------------------------
// Unit tests for openai.ts — createChatClient, fetchOpenAIModels,
// and makeSseChatTransport request / stream-parsing logic.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createChatClient,
  fetchOpenAIModels,
  makeSseChatTransport,
  type ChatStreamHandlers,
  type ChatTransport,
} from '../openai';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(body: unknown, status = 200) {
  const stub = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    body: null,
  } as unknown as Response;
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(stub);
}

// ---------------------------------------------------------------------------
// createChatClient
// ---------------------------------------------------------------------------

describe('createChatClient', () => {
  it('exposes the configured baseUrl', () => {
    const transport: ChatTransport = { stream: vi.fn() };
    const client = createChatClient({ baseUrl: '/v1', transport });
    expect(client.baseUrl).toBe('/v1');
  });

  it('streamChat delegates to the transport.stream method', () => {
    const streamMock = vi.fn();
    const transport: ChatTransport = { stream: streamMock };
    const client = createChatClient({ baseUrl: '/v1', transport });

    const req = { model: 'llama3-8b', messages: [] };
    const handlers: ChatStreamHandlers = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };
    client.streamChat(req, handlers);
    expect(streamMock).toHaveBeenCalledOnce();
    expect(streamMock).toHaveBeenCalledWith(req, handlers);
  });

  it('listModels uses the custom listModels function when provided', async () => {
    const transport: ChatTransport = { stream: vi.fn() };
    const mockListModels = vi.fn().mockResolvedValue([{ id: 'llama3', object: 'model', ownedBy: 'purser' }]);
    const client = createChatClient({ baseUrl: '/v1', transport, listModels: mockListModels });

    const models = await client.listModels();
    expect(mockListModels).toHaveBeenCalledOnce();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('llama3');
  });

  it('listModels falls back to fetchOpenAIModels when not provided', async () => {
    mockFetchJson({ data: [{ id: 'llama3', object: 'model', owned_by: 'purser' }] });
    const transport: ChatTransport = { stream: vi.fn() };
    const client = createChatClient({ baseUrl: '/v1', transport });

    const models = await client.listModels();
    expect(models[0].id).toBe('llama3');
  });
});

// ---------------------------------------------------------------------------
// fetchOpenAIModels
// ---------------------------------------------------------------------------

describe('fetchOpenAIModels', () => {
  it('returns models from the /models endpoint', async () => {
    mockFetchJson({
      data: [
        { id: 'llama3-8b', object: 'model', owned_by: 'purser' },
        { id: 'mixtral', object: 'model', owned_by: 'purser' },
      ],
    });
    const models = await fetchOpenAIModels('/v1');
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('llama3-8b');
    expect(models[0].object).toBe('model');
  });

  it('normalizes owned_by (snake_case) to ownedBy (camelCase)', async () => {
    mockFetchJson({
      data: [{ id: 'm1', owned_by: 'acme', object: 'model' }],
    });
    const models = await fetchOpenAIModels('/v1');
    expect(models[0].ownedBy).toBe('acme');
  });

  it('also accepts ownedBy (camelCase) when already in that form', async () => {
    mockFetchJson({
      data: [{ id: 'm2', ownedBy: 'purser-gw', object: 'model' }],
    });
    const models = await fetchOpenAIModels('/v1');
    expect(models[0].ownedBy).toBe('purser-gw');
  });

  it('defaults ownedBy to "purser" when field is absent', async () => {
    mockFetchJson({ data: [{ id: 'm3', object: 'model' }] });
    const models = await fetchOpenAIModels('/v1');
    expect(models[0].ownedBy).toBe('purser');
  });

  it('defaults id to empty string when absent', async () => {
    mockFetchJson({ data: [{ object: 'model' }] });
    const models = await fetchOpenAIModels('/v1');
    expect(models[0].id).toBe('');
  });

  it('returns empty array when data field is absent', async () => {
    mockFetchJson({ models: [] });
    const models = await fetchOpenAIModels('/v1');
    expect(models).toEqual([]);
  });

  it('throws when the gateway responds non-ok', async () => {
    mockFetchJson({ error: 'bad request' }, 400);
    await expect(fetchOpenAIModels('/v1')).rejects.toThrow('Gateway responded 400');
  });

  it('sends Authorization header when apiKey is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);
    await fetchOpenAIModels('/v1', 'sk-purser-test');
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-purser-test');
  });

  it('omits Authorization header when apiKey is not provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);
    await fetchOpenAIModels('/v1');
    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// makeSseChatTransport
// ---------------------------------------------------------------------------

describe('makeSseChatTransport', () => {
  it('calls the correct endpoint with POST and JSON body', async () => {
    // Simulate a minimal ReadableStream that ends immediately.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    } as unknown as Response);

    const transport = makeSseChatTransport({ baseUrl: '/v1', apiKey: 'sk-test' });
    const onDone = vi.fn();
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'llama3', messages: [] },
        { onToken: vi.fn(), onDone: (r) => { onDone(r); resolve(); }, onError },
      );
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/v1/chat/completions');
    expect(opts?.method).toBe('POST');
    expect(onDone).toHaveBeenCalledWith('stop');
    expect(onError).not.toHaveBeenCalled();
  });

  it('includes Authorization header when apiKey is provided', async () => {
    const stream = new ReadableStream({
      start(c) { c.close(); },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const transport = makeSseChatTransport({ baseUrl: '/v1', apiKey: 'my-key' });
    transport.stream({ model: 'x', messages: [] }, { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-key');
  });

  it('calls onError when gateway responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: null,
    } as unknown as Response);

    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: vi.fn(), onDone: vi.fn(), onError: (e) => { onError(e); resolve(); } },
      );
    });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toContain('503');
  });

  it('calls onError when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: vi.fn(), onDone: vi.fn(), onError: (e) => { onError(e); resolve(); } },
      );
    });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toBe('ECONNREFUSED');
  });

  it('streams tokens from SSE data: frames', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: () => resolve(), onError: vi.fn() },
      );
    });
    expect(tokens).toEqual(['Hello', ' world']);
  });

  it('silently ignores keep-alive and malformed JSON data: lines (L98-100 catch block)', async () => {
    // Sends: one malformed JSON line (exercises L98-100 catch), then valid token, then DONE.
    const encoder = new TextEncoder();
    const frames = [
      'data: {not valid json}\n\n',    // ← exercises catch block (L98-100)
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: () => resolve(), onError: vi.fn() },
      );
    });
    // The malformed line is silently ignored; the valid token still arrives.
    expect(tokens).toEqual(['hi']);
  });

  it('abort signal closes the stream without calling onError (L63 listener + L106 guard)', async () => {
    // Setup: the abort happens INSIDE the fetch mock, which ensures that:
    //  1. handlers.signal.addEventListener('abort', ...) fires → controller.abort() is called (L63)
    //  2. The fetch rejects with AbortError
    //  3. The .catch handler sees controller.signal.aborted=true → returns early (L106)
    //  4. onError is NOT called
    const ac = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
      ac.abort(); // triggers the 'abort' listener → controller.abort()
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: vi.fn(), onDone: vi.fn(), onError, signal: ac.signal },
      );
      setTimeout(resolve, 50);
    });
    // With correct code: abort listener fires → controller aborted → guard returns → no onError.
    // Kills: L63 listener mutations (StringLiteral/'abort'→'', ArrowFn→undefined)
    // Kills: L106 ConditionalExpression/false (without guard, onError would be called).
    expect(onError).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Mutation killers — targeting specific survived mutants
  // ---------------------------------------------------------------------------

  it('calls onError when res.ok=true but res.body=null (L75 || → && mutation)', async () => {
    // Mutation: `!res.ok || !res.body` → `!res.ok && !res.body`
    // With mutation: ok=true, body=null → condition false → tries to call res.body.getReader() → crash
    // With correct code: condition true → throws "Gateway responded ..." → onError called
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
    } as unknown as Response);

    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    const onError = vi.fn();
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: vi.fn(), onDone: vi.fn(), onError: (e) => { onError(e); resolve(); } },
      );
    });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toContain('200');
  });

  it('handles extra whitespace after "data:" in SSE lines (L88 regex mutations)', async () => {
    // Tests that /^data:\s*/ correctly strips "data:" + any whitespace.
    // Mutations: /data:\s*/ (no ^), /^data:\s/ (single space, not *), /^data:\S*/ (wrong class)
    // With /^data:\s/ (no *), "data:  [DONE]" → "  [DONE]" (one space consumed, one left) → not '[DONE]'
    const encoder = new TextEncoder();
    // Extra spaces after "data:": should still be recognized as [DONE] and as token
    const frames = [
      'data:  {"choices":[{"delta":{"content":"hi"}}]}\n\n',  // 2 spaces after colon
      'data:  [DONE]\n\n',                                      // 2 spaces after colon
    ].join('');
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: () => resolve(), onError: vi.fn() },
      );
    });
    expect(tokens).toEqual(['hi']);
  });

  it('stops processing after [DONE] and ignores subsequent data frames (L90 mutations)', async () => {
    // Mutations: `if (line === '[DONE]')` → false (ConditionalExpression) or '' (StringLiteral)
    // If condition is false/wrong, the stream continues past [DONE] and processes "post" token.
    const encoder = new TextEncoder();
    const frames = [
      'data: {"choices":[{"delta":{"content":"pre"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"post"}}]}\n\n',
    ].join('');
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const onDone = vi.fn();
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: (r) => { onDone(r); resolve(); }, onError: vi.fn() },
      );
    });
    // Only "pre" should be received; [DONE] causes early return → "post" never processed.
    expect(tokens).toEqual(['pre']);
    expect(onDone).toHaveBeenCalledWith('stop');
  });

  it('does not call onToken for a delta with empty or absent content (L97 ConditionalExpression → true)', async () => {
    // Mutation: `if (delta)` → `if (true)` — calls onToken('') for empty deltas
    const encoder = new TextEncoder();
    const frames = [
      'data: {"choices":[{"delta":{}}]}\n\n',                // delta has no content
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',    // content is empty string
      'data: {"choices":[{"delta":{"content":"real"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: () => resolve(), onError: vi.fn() },
      );
    });
    // Only the non-empty "real" token should be emitted; empty deltas are skipped.
    expect(tokens).toEqual(['real']);
  });

  it('calls onDone("stop") when stream ends naturally without [DONE] (L103 StringLiteral mutation)', async () => {
    // Mutation: `handlers.onDone('stop')` at L103 → `handlers.onDone('')`
    // L91 is also `handlers.onDone('stop')` (triggered by [DONE]) — this test exercises L103 only.
    const encoder = new TextEncoder();
    const frames = 'data: {"choices":[{"delta":{"content":"token"}}]}\n\n'; // NO [DONE]
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frames)); c.close(); }, // reader.read() → done=true
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const onDone = vi.fn();
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: vi.fn(), onDone: (r) => { onDone(r); resolve(); }, onError: vi.fn() },
      );
    });
    // Stream ends with done=true (no [DONE] marker) → L103 path → must be 'stop'
    expect(onDone).toHaveBeenCalledWith('stop');
  });

  it('verifies fetch is called at the correct /models URL (L115 StringLiteral mutation)', async () => {
    // Mutation: `${baseUrl}/models` → `` (empty string URL)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);

    await fetchOpenAIModels('/v1', 'key');
    expect(fetchSpy.mock.calls[0][0]).toBe('/v1/models');
  });

  it('returns empty array when json is null (L120 OptionalChaining: json?.data → json.data)', async () => {
    // Mutation: `json?.data` → `json.data` — if json=null, `null.data` throws TypeError
    // With correct code: `null?.data` = undefined → not an Array → returns []
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve(null),
    } as unknown as Response);

    const models = await fetchOpenAIModels('/v1');
    expect(models).toEqual([]);
  });

  it('includes Content-Type: application/json header in SSE request (L68 StringLiteral mutation)', async () => {
    // Mutation: `'application/json'` → `""` — header value becomes empty string
    const stream = new ReadableStream({ start(c) { c.close(); } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const transport = makeSseChatTransport({ baseUrl: '/v1', apiKey: 'k' });
    transport.stream({ model: 'x', messages: [] }, { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends request body with stream:true and includes request fields (L71 body mutations)', async () => {
    // Mutations: ObjectLiteral → {} (body empty) or BooleanLiteral → stream:false
    const stream = new ReadableStream({ start(c) { c.close(); } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const req = { model: 'llama3', messages: [{ role: 'user' as const, content: 'hello' }] };
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    transport.stream(req, { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('llama3');
    expect(body.messages).toHaveLength(1);
  });

  it('handles partial SSE buffer across chunks — events.pop() ?? "" (L86 LogicalOperator)', async () => {
    // Mutation: `events.pop() ?? ''` → `events.pop() && ''`
    // Original: pop() returns partial event string → buffer preserves it
    // Mutation: pop() returns partial string → 'partial' && '' = '' → partial is LOST
    // Test: send token split across two chunks; with mutation the split token is lost.
    const encoder = new TextEncoder();
    // Chunk 1: ends mid-event (no trailing \n\n)
    const chunk1 = encoder.encode('data: {"choices":[{"delta":{"content":"hel');
    // Chunk 2: completes the event
    const chunk2 = encoder.encode('lo"}}]}\n\ndata: [DONE]\n\n');
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(chunk1);
        c.enqueue(chunk2);
        c.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, body: stream,
    } as unknown as Response);

    const tokens: string[] = [];
    const transport = makeSseChatTransport({ baseUrl: '/v1' });
    await new Promise<void>((resolve) => {
      transport.stream(
        { model: 'x', messages: [] },
        { onToken: (t) => tokens.push(t), onDone: () => resolve(), onError: vi.fn() },
      );
    });
    // With correct code: chunk1 partial is buffered → chunk2 completes it → 'hello' token
    // With mutation (&&''): partial is lost → incomplete JSON → silently ignored → no token
    expect(tokens).toEqual(['hello']);
  });
});
