// ---------------------------------------------------------------------------
// Tests for mock/studio.ts — canned model specs and plan preview.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { CANNED_MODELS, cannedModelForSource, mockPreviewPlan } from '../studio';
import type { ImportSource, NodeView } from '../../api/types';

// ---------------------------------------------------------------------------
// CANNED_MODELS completeness
// ---------------------------------------------------------------------------

describe('CANNED_MODELS', () => {
  const expectedTypes: Array<keyof typeof CANNED_MODELS> = [
    'huggingface',
    'object_storage',
    'sagemaker',
    'vertexai',
    'azure_ml',
  ];

  it.each(expectedTypes)('has an entry for source type %s', (type) => {
    expect(CANNED_MODELS[type]).toBeDefined();
  });

  it.each(expectedTypes)('model for %s has required fields', (type) => {
    const m = CANNED_MODELS[type];
    expect(typeof m.modelId).toBe('string');
    expect(m.modelId.length).toBeGreaterThan(0);
    expect(m.paramsTotalB).toBeGreaterThan(0);
    expect(m.paramsActiveB).toBeGreaterThan(0);
    expect(m.layers).toBeGreaterThan(0);
    expect(Array.isArray(m.quantizations)).toBe(true);
    expect(m.quantizations.length).toBeGreaterThan(0);
  });

  it.each(expectedTypes)('model for %s has at least one quantization with sizeGb > 0', (type) => {
    for (const q of CANNED_MODELS[type].quantizations) {
      expect(q.sizeGb).toBeGreaterThan(0);
    }
  });

  it('huggingface model has HF modelId prefix', () => {
    expect(CANNED_MODELS['huggingface'].modelId).toMatch(/^hf:/);
  });

  it('sagemaker model has sm: prefix', () => {
    expect(CANNED_MODELS['sagemaker'].modelId).toMatch(/^sm:/);
  });

  it('vertexai model has vertex: prefix', () => {
    expect(CANNED_MODELS['vertexai'].modelId).toMatch(/^vertex:/);
  });

  it('azure_ml model has azure: prefix', () => {
    expect(CANNED_MODELS['azure_ml'].modelId).toMatch(/^azure:/);
  });
});

// ---------------------------------------------------------------------------
// cannedModelForSource
// ---------------------------------------------------------------------------

describe('cannedModelForSource', () => {
  it('returns the HF model for huggingface source', () => {
    const source: ImportSource = { type: 'huggingface', repo: 'meta-llama/Llama-3.1-8B' };
    const model = cannedModelForSource(source);
    expect(model).toBe(CANNED_MODELS['huggingface']);
  });

  it('returns object_storage model for object_storage source', () => {
    const source: ImportSource = { type: 'object_storage', uri: 's3://bucket/model', name: 'gemma', family: 'Gemma' };
    expect(cannedModelForSource(source)).toBe(CANNED_MODELS['object_storage']);
  });

  it('returns sagemaker model for sagemaker source', () => {
    const source: ImportSource = { type: 'sagemaker', modelGroup: 'mistral-7b' };
    expect(cannedModelForSource(source)).toBe(CANNED_MODELS['sagemaker']);
  });

  it('returns vertexai model for vertexai source', () => {
    const source: ImportSource = { type: 'vertexai', modelPath: 'projects/p/models/gemini-nano' };
    expect(cannedModelForSource(source)).toBe(CANNED_MODELS['vertexai']);
  });

  it('returns azure_ml model for azure_ml source', () => {
    const source: ImportSource = { type: 'azure_ml', workspace: 'my-ws', modelName: 'phi-3-mini' };
    expect(cannedModelForSource(source)).toBe(CANNED_MODELS['azure_ml']);
  });
});

// ---------------------------------------------------------------------------
// mockPreviewPlan
// ---------------------------------------------------------------------------

function makeReadyNode(nodeId: string, vramGb: number, unified = false): NodeView {
  return {
    profile: {
      nodeId,
      hostname: nodeId,
      os: 'linux',
      arch: 'x86_64',
      backends: ['cuda'],
      gpus: [{ name: 'GPU', vramGb, unified, fp4Native: false, count: 1 }],
      ramTotalGb: vramGb,
      ramAvailableGb: vramGb,
      memBandwidthGbs: 500,
      diskFreeGb: 1000,
      engineVersions: {},
      lastSeen: new Date().toISOString(),
      state: 'ready',
    },
    metrics: null,
    role: null,
    linkQuality: 'good',
    deploymentId: null,
  };
}

describe('mockPreviewPlan', () => {
  it('returns feasible=true with a plan when model fits the fleet', () => {
    const nodes = [makeReadyNode('n1', 200)];
    const model = CANNED_MODELS['huggingface']; // ~5–9 GB, well within 200 GB
    const result = mockPreviewPlan(model, nodes);
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.plan).toBeDefined();
      expect(result.plan!.modelId).toBe(model.modelId);
    }
  });

  it('returns feasible=false with a reason when model is too large for fleet', () => {
    // Fleet has only 2 GB usable — deepseek-r1-671b won't fit (404 GB smallest quant)
    const nodes = [makeReadyNode('n1', 2)];
    // Use the HF model's smallest quant (5 GB) — 5 * 0.85 = 4.25 > 2*0.85 = 1.7 GB
    const model = CANNED_MODELS['huggingface']; // smallest Q4_K_M = 5 GB
    const result = mockPreviewPlan(model, nodes);
    expect(result.feasible).toBe(false);
    if (!result.feasible) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });

  it('infeasible reason message mentions required size', () => {
    const nodes = [makeReadyNode('n1', 1)];
    const model = CANNED_MODELS['object_storage']; // 17 GB smallest quant
    const result = mockPreviewPlan(model, nodes);
    expect(result.feasible).toBe(false);
    if (!result.feasible) {
      // Message should mention GB or size information
      expect(result.reason).toMatch(/GB/i);
    }
  });

  it('fleet without any ready nodes returns infeasible', () => {
    // No nodes at all
    const result = mockPreviewPlan(CANNED_MODELS['huggingface'], []);
    expect(result.feasible).toBe(false);
  });

  it('unified memory nodes use max(vram, ram) for capacity calculation', () => {
    // Exercises the `unified ? Math.max(vram, n.profile.ramTotalGb) : ...` branch
    const unifiedNode = makeReadyNode('mac-1', 96, true); // unified=true, vramGb=96, ramTotalGb=96
    // fleetGb = max(96, 96) = 96; smallest quant of hfLlama = 5 GB; 5*0.85=4.25 <= 96 → feasible
    const result = mockPreviewPlan(CANNED_MODELS['huggingface'], [unifiedNode]);
    expect(result.feasible).toBe(true);
  });

  it('non-unified GPU node uses raw vram', () => {
    // Exercises the `: vram || n.profile.ramTotalGb` branch when vram > 0
    const gpuNode = makeReadyNode('rtx-1', 24, false); // non-unified, vramGb=24
    // fleetGb = 24 (vram, not ram); 5*0.85=4.25 <= 24 → feasible
    const result = mockPreviewPlan(CANNED_MODELS['huggingface'], [gpuNode]);
    expect(result.feasible).toBe(true);
  });

  it('CPU-only node (no GPU, vram=0) uses ramTotalGb as capacity', () => {
    // Exercises the `vram || n.profile.ramTotalGb` branch when vram=0
    const cpuNode: NodeView = {
      profile: {
        nodeId: 'cpu-1', hostname: 'cpu-host', os: 'linux', arch: 'x86_64',
        backends: ['cpu'], gpus: [],
        ramTotalGb: 64, ramAvailableGb: 64, memBandwidthGbs: 50, diskFreeGb: 500,
        engineVersions: {}, lastSeen: new Date().toISOString(), state: 'ready',
      },
      metrics: null, role: null, linkQuality: 'unknown', deploymentId: null,
    };
    // fleetGb = 0 || 64 = 64; 5*0.85=4.25 <= 64 → feasible for small models
    const result = mockPreviewPlan(CANNED_MODELS['sagemaker'], [cpuNode]); // smallest quant = 4 GB
    expect(result.feasible).toBe(true);
  });

  it('degraded nodes are not counted toward fleet capacity', () => {
    // Only degraded nodes
    const nodes: NodeView[] = [
      {
        profile: {
          nodeId: 'n1', hostname: 'n1', os: 'linux', arch: 'x86_64',
          backends: ['cuda'], gpus: [{ name: 'GPU', vramGb: 200, unified: false, fp4Native: false, count: 1 }],
          ramTotalGb: 200, ramAvailableGb: 200, memBandwidthGbs: 500, diskFreeGb: 1000,
          engineVersions: {}, lastSeen: new Date().toISOString(),
          state: 'degraded',
        },
        metrics: null, role: null, linkQuality: 'poor', deploymentId: null,
      },
    ];
    const result = mockPreviewPlan(CANNED_MODELS['huggingface'], nodes);
    // fleetGb = 0 (no ready/running nodes) → smallest quant (5 GB) * 0.85 > 0 → infeasible
    expect(result.feasible).toBe(false);
  });

  it('smallest quant reduce covers false branch (descending quant order)', () => {
    // Exercises the false branch of `(a.sizeGb < b.sizeGb ? a : b)` in reduce
    // when `b.sizeGb < a.sizeGb` (i.e., a later quant is smaller than the current min)
    const nodes = [makeReadyNode('n1', 200)];
    // Pass a custom model with quants in DESCENDING order: 29 GB first, 17 GB second
    // reduce: a={29}, b={17} → 29 < 17 = false → return b={17} ← false branch
    const customModel = {
      ...CANNED_MODELS['object_storage'],
      quantizations: [
        { name: 'Q8_0', sizeGb: 29, requiresFp4: false, quality: 0.98, emulatedFp4: false },
        { name: 'Q4_K_M', sizeGb: 17, requiresFp4: false, quality: 0.9, emulatedFp4: false },
      ],
    };
    const result = mockPreviewPlan(customModel, nodes);
    expect(result.feasible).toBe(true); // 17 GB smallest, fleet=200 GB — fits
  });

  it('the plan returned in feasible result has correct quantization and assignments', () => {
    const nodes = [makeReadyNode('n1', 200)];
    const model = CANNED_MODELS['sagemaker']; // small: 4-5 GB
    const result = mockPreviewPlan(model, nodes);
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.plan!.quantization).toBeDefined();
      expect(result.plan!.assignments.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// data.ts — seed data integrity (imported here to keep in scope)
// ---------------------------------------------------------------------------
import { mockNodes, mockModels, mockJoinInfo, mockApiKeys } from '../data';

describe('mock seed data — data.ts', () => {
  it('mockNodes has unique nodeIds', () => {
    const ids = mockNodes.map((n) => n.profile.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mockNodes each has a valid state', () => {
    const validStates = new Set([
      'provisioning', 'enrolled', 'ready', 'loading', 'running',
      'degraded', 'draining', 'unreachable', 'decommissioned',
    ]);
    for (const n of mockNodes) {
      expect(validStates.has(n.profile.state)).toBe(true);
    }
  });

  it('mockModels has unique modelIds', () => {
    const ids = mockModels.map((m) => m.modelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mockModels each has at least one quantization', () => {
    for (const m of mockModels) {
      expect(m.quantizations.length).toBeGreaterThan(0);
    }
  });

  it('mockModels quantization sizes are all positive', () => {
    for (const m of mockModels) {
      for (const q of m.quantizations) {
        expect(q.sizeGb).toBeGreaterThan(0);
      }
    }
  });

  it('mockModels paramsActiveB <= paramsTotalB', () => {
    for (const m of mockModels) {
      expect(m.paramsActiveB).toBeLessThanOrEqual(m.paramsTotalB);
    }
  });

  it('mockJoinInfo has a joinToken starting with prsr_join_', () => {
    expect(mockJoinInfo.joinToken).toMatch(/^prsr_join_/);
  });

  it('mockJoinInfo controlPlaneUrl is a valid URL', () => {
    expect(() => new URL(mockJoinInfo.controlPlaneUrl)).not.toThrow();
  });

  it('mockApiKeys has unique ids', () => {
    const ids = mockApiKeys.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mockApiKeys each has a valid prefix format', () => {
    for (const k of mockApiKeys) {
      expect(k.prefix).toMatch(/^sk-purser-/);
    }
  });
});
