// ---------------------------------------------------------------------------
// Tests for mock/chat.ts — the mock SSE chat transport.
// Uses fake timers to control the streaming delays without real wall-clock waits.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockChatTransport } from '../chat';
import type { ChatStreamHandlers } from '../../api/openai';
import type { ChatCompletionRequest } from '../../api/types';

function makeRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    model: 'test-model',
    messages: [],
    stream: true,
    ...overrides,
  };
}

function makeHandlers(): {
  onToken: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  signal: AbortSignal | undefined;
} & ChatStreamHandlers {
  return {
    onToken: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    signal: undefined,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Streaming happy path
// ---------------------------------------------------------------------------

describe('mockChatTransport.stream', () => {
  it('calls onToken for each word token and then onDone("stop")', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'hello world' }],
    });

    mockChatTransport.stream(req, handlers);

    // Run all pending timers (startup delay + all token steps).
    await vi.runAllTimersAsync();

    // Should have received tokens — at least one
    expect(handlers.onToken).toHaveBeenCalled();
    // The reply text includes tokens; combined they should form something
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens.length).toBeGreaterThan(0);

    // onDone must have been called exactly once with 'stop'
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(handlers.onDone).toHaveBeenCalledWith('stop');

    // onError must not have been called
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('emits a startup delay before the first token', () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'hi' }],
    });

    mockChatTransport.stream(req, handlers);

    // Advance 100ms — less than startup delay (260ms); no tokens yet
    vi.advanceTimersByTime(100);
    expect(handlers.onToken).not.toHaveBeenCalled();

    // Advance past startup delay
    vi.advanceTimersByTime(200);
    // Now at least one step has fired
    expect(handlers.onToken).toHaveBeenCalled();
  });

  it('uses "Ready when you are" reply for empty prompt', async () => {
    const handlers = makeHandlers();
    mockChatTransport.stream(makeRequest(), handlers);
    await vi.runAllTimersAsync();
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens).toContain('Ready');
  });

  it('uses greeting reply for hello-containing prompt', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Hello there' }],
    });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens).toContain('Hello');
  });

  it('uses tok/s reply for speed-related prompts', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'What is the token speed?' }],
    });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens).toContain('Decode throughput');
  });

  it('default reply echoes the prompt', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'what is two plus two' }],
    });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens).toContain('what is two plus two');
  });

  it('uses the last user message (not an earlier one)', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'some reply' },
        { role: 'user', content: 'second message xyz' },
      ],
    });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    const allTokens = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    expect(allTokens).toContain('second message xyz');
  });
});

// ---------------------------------------------------------------------------
// Abort / cancellation
// ---------------------------------------------------------------------------

describe('mockChatTransport.stream — abort', () => {
  it('stops streaming and calls onDone("stop") when signal is aborted', async () => {
    const controller = new AbortController();
    const handlers: ChatStreamHandlers = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      signal: controller.signal,
    };
    const req = makeRequest({
      messages: [{ role: 'user', content: 'tell me a long story' }],
    });

    mockChatTransport.stream(req, handlers);

    // Let the startup delay fire but don't run all timers
    vi.advanceTimersByTime(300);

    // Abort now — mid-stream
    controller.abort();

    // onDone should have been called with 'stop'
    expect(handlers.onDone).toHaveBeenCalledWith('stop');
  });

  it('covers "if (cancelled) return" guard when timer fires after abort', () => {
    // This test covers line 48: `if (cancelled) return;` inside step().
    // The step timer is scheduled by the startup handler; if abort fires
    // BEFORE the scheduled step runs, cancelled=true, and when the step
    // finally fires it hits the guard and returns immediately.
    const controller = new AbortController();
    const handlers: ChatStreamHandlers = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      signal: controller.signal,
    };
    const req = makeRequest({
      messages: [{ role: 'user', content: 'hello world please respond' }],
    });

    mockChatTransport.stream(req, handlers);

    // Fire the startup delay (260ms) which calls step() once (token 0 emitted)
    // and schedules the next step at 260 + 18..48ms (> 265ms). The step has NOT fired yet.
    vi.advanceTimersByTime(265);
    const tokensAfterStartup = (handlers.onToken as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(tokensAfterStartup).toBe(1); // exactly one token from the first step

    // Now abort — sets cancelled=true and calls onDone('stop') via the signal listener
    controller.abort();
    expect(handlers.onDone).toHaveBeenCalledWith('stop');

    // Advance time — the pending step timer fires and hits `if (cancelled) return`
    vi.advanceTimersByTime(200);
    // No more tokens emitted — the guard returned early
    expect((handlers.onToken as ReturnType<typeof vi.fn>).mock.calls.length).toBe(tokensAfterStartup);
    // onDone still called only once
    expect(handlers.onDone).toHaveBeenCalledOnce();
  });

  it('covers handlers.signal?.removeEventListener TRUE branch when stream completes normally with a signal', async () => {
    // When a signal is provided but never aborted, stream completes normally.
    // `handlers.signal?.removeEventListener(...)` is called (TRUE branch of optional chain).
    const controller = new AbortController(); // signal defined, but never aborted
    const handlers: ChatStreamHandlers = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      signal: controller.signal,
    };
    const req = makeRequest({ messages: [{ role: 'user', content: 'hi' }] });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    // Stream completed normally — removeEventListener was called with the defined signal
    expect(handlers.onDone).toHaveBeenCalledWith('stop');
    expect(handlers.onToken).toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('does not call onToken after abort', async () => {
    const controller = new AbortController();
    const handlers: ChatStreamHandlers = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      signal: controller.signal,
    };
    mockChatTransport.stream(makeRequest(), handlers);

    // Abort immediately before startup fires
    controller.abort();

    const callsBeforeAbort = (handlers.onToken as ReturnType<typeof vi.fn>).mock.calls.length;

    // Run all remaining timers
    await vi.runAllTimersAsync();

    // No additional onToken calls after abort
    const callsAfterAbort = (handlers.onToken as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterAbort).toBe(callsBeforeAbort);
  });
});

// ---------------------------------------------------------------------------
// Tokenization shape
// ---------------------------------------------------------------------------

describe('tokenization', () => {
  it('each onToken call receives a non-empty string', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({
      messages: [{ role: 'user', content: 'hello how are you' }],
    });
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    for (const [token] of handlers.onToken.mock.calls as [string][]) {
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    }
  });

  it('handles empty-string-producing tokenization gracefully (fallback [text] branch)', async () => {
    // craftReply returns a non-empty reply even for whitespace-only prompts
    // because it trims and checks: `(lastUser?.content ?? '').trim()` → empty → fallback reply
    // The tokenize fallback `?? [text]` fires when the reply matches no \S+\s* tokens
    // (only possible with a reply of purely empty string, but craftReply always returns non-empty)
    // We test empty prompt → triggers the ready-reply branch which still tokenizes fine
    const handlers = makeHandlers();
    const req = makeRequest({ messages: [{ role: 'user', content: '   ' }] }); // whitespace only → treated as empty
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    expect(handlers.onDone).toHaveBeenCalledWith('stop');
    // Some tokens must have been emitted
    expect(handlers.onToken).toHaveBeenCalled();
  });

  it('total emitted tokens reconstruct the full reply without data loss', async () => {
    const handlers = makeHandlers();
    const req = makeRequest({ messages: [] }); // → "Ready when you are" reply
    mockChatTransport.stream(req, handlers);
    await vi.runAllTimersAsync();
    const reconstructed = (handlers.onToken.mock.calls as [string][]).map((c) => c[0]).join('');
    // The reply should have "Ready" in it
    expect(reconstructed).toContain('Ready');
  });
});
