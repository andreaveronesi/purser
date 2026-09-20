// ---------------------------------------------------------------------------
// Tests for mock/wiring.ts — the aggregation point exported to the mock client.
// Specifically tests mockListModels, which derives OpenAIModel list from active
// deployments — the only logic in wiring.ts that is not tested elsewhere.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockListModels, mockBackend, mockChatTransport } from '../wiring';

async function flush<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mockListModels', () => {
  it('returns OpenAIModel entries for active deployments', async () => {
    const models = await flush(mockListModels());
    // The seed deployment 'dep-qwen3-moe' is active at module init, so
    // mockListModels should return at least one model.
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it('each model has id, object="model", ownedBy="purser"', async () => {
    const models = await flush(mockListModels());
    for (const m of models) {
      expect(typeof m.id).toBe('string');
      expect(m.object).toBe('model');
      expect(m.ownedBy).toBe('purser');
    }
  });

  it('model ids match the active deployments plan modelIds', async () => {
    const [models, deps] = await Promise.all([
      flush(mockListModels()),
      flush(mockBackend.listDeployments()),
    ]);
    const activeDepsModelIds = new Set(
      deps.filter((d) => d.state === 'active').map((d) => d.plan.modelId),
    );
    for (const m of models) {
      expect(activeDepsModelIds.has(m.id)).toBe(true);
    }
  });

  it('returns empty array when no active deployments', async () => {
    // Undeploy the seeded deployment
    await flush(mockBackend.undeployDeployment('dep-qwen3-moe'));
    const models = await flush(mockListModels());
    expect(models).toHaveLength(0);
  });
});

describe('wiring re-exports', () => {
  it('mockBackend is the in-memory backend', () => {
    expect(mockBackend).toBeDefined();
    expect(typeof mockBackend.listNodes).toBe('function');
  });

  it('mockChatTransport is the mock chat transport', () => {
    expect(mockChatTransport).toBeDefined();
    expect(typeof mockChatTransport.stream).toBe('function');
  });
});
