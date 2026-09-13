// ---------------------------------------------------------------------------
// Tests for mock/planner.ts — pure DP math and shape computations.
// No async, no timers needed: all functions are synchronous.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import {
  computeCapacity,
  computeFit,
  buildCatalog,
  buildPlan,
  planToDeployment,
} from '../planner';
import type { NodeView, ModelSpec } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers — minimal fixtures
// ---------------------------------------------------------------------------

function makeGpuNode(opts: {
  nodeId?: string;
  hostname?: string;
  state?: NodeView['profile']['state'];
  vramGb: number;
  unified?: boolean;
  fp4?: boolean;
  gpuCount?: number;
  ramTotalGb?: number;
  ramAvailableGb?: number;
  linkQuality?: NodeView['linkQuality'];
  decodeTokS?: number;
}): NodeView {
  const {
    nodeId = 'node-1',
    hostname = 'host-1',
    state = 'ready',
    vramGb,
    unified = false,
    fp4 = false,
    gpuCount = 1,
    ramTotalGb = 64,
    ramAvailableGb = 48,
    linkQuality = 'good',
    decodeTokS,
  } = opts;
  return {
    profile: {
      nodeId,
      hostname,
      os: 'linux',
      arch: 'x86_64',
      backends: ['cuda', 'cpu'],
      gpus: [{ name: 'GPU', vramGb, unified, fp4Native: fp4, count: gpuCount }],
      ramTotalGb,
      ramAvailableGb,
      memBandwidthGbs: 500,
      diskFreeGb: 1000,
      engineVersions: { 'llama.cpp': 'b4021' },
      lastSeen: new Date().toISOString(),
      state,
    },
    metrics: decodeTokS !== undefined ? {
      prefillTokS: 300,
      decodeTokS,
      ramUsedGb: 10,
      vramUsedGb: 20,
      queueDepth: 0,
      acceptedTokensRatio: 0.8,
    } : null,
    role: null,
    linkQuality,
    deploymentId: null,
  };
}

function makeCpuNode(opts: {
  nodeId?: string;
  state?: NodeView['profile']['state'];
  ramTotalGb: number;
  ramAvailableGb?: number;
}): NodeView {
  const { nodeId = 'cpu-1', state = 'ready', ramTotalGb, ramAvailableGb = ramTotalGb } = opts;
  return {
    profile: {
      nodeId,
      hostname: `${nodeId}-host`,
      os: 'linux',
      arch: 'x86_64',
      backends: ['cpu'],
      gpus: [],
      ramTotalGb,
      ramAvailableGb,
      memBandwidthGbs: 50,
      diskFreeGb: 500,
      engineVersions: {},
      lastSeen: new Date().toISOString(),
      state,
    },
    metrics: null,
    role: null,
    linkQuality: 'unknown',
    deploymentId: null,
  };
}

function makeModel(opts: {
  modelId?: string;
  paramsTotalB?: number;
  paramsActiveB?: number;
  layers?: number;
  quants: Array<{ name: string; sizeGb: number; fp4?: boolean; quality?: number }>;
  isMoe?: boolean;
  draftAvailable?: boolean;
}): ModelSpec {
  const {
    modelId = 'test-model',
    paramsTotalB = 70,
    paramsActiveB = 70,
    layers = 80,
    quants,
    isMoe = false,
    draftAvailable = false,
  } = opts;
  return {
    modelId,
    family: 'Test',
    architecture: 'LlamaForCausalLM',
    paramsTotalB,
    paramsActiveB,
    layers,
    hiddenSize: 4096,
    nKvHeads: 8,
    headDim: 128,
    attentionType: 'gqa',
    contextMax: 8192,
    isMoe,
    draft: { available: draftAvailable, type: draftAvailable ? 'ngram' : '', tailLayers: 0 },
    engine: 'llama.cpp',
    quantizations: quants.map((q) => ({
      name: q.name,
      sizeGb: q.sizeGb,
      requiresFp4: q.fp4 ?? false,
      quality: q.quality ?? 0.9,
      emulatedFp4: false,
    })),
  };
}

// ---------------------------------------------------------------------------
// computeCapacity
// ---------------------------------------------------------------------------

describe('computeCapacity', () => {
  it('handles empty node list', () => {
    const cap = computeCapacity([]);
    expect(cap.nodeCount).toBe(0);
    expect(cap.readyNodeCount).toBe(0);
    expect(cap.vramTotalGb).toBe(0);
    expect(cap.vramAvailableGb).toBe(0);
    expect(cap.ramTotalGb).toBe(0);
    expect(cap.gpuCount).toBe(0);
    expect(cap.fp4Capable).toBe(false);
    expect(cap.aggregateDecodeTokS).toBe(0);
    expect(cap.backends).toEqual([]);
  });

  it('counts only ready/running nodes in readyNodeCount', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24 }),
      makeGpuNode({ nodeId: 'n2', state: 'running', vramGb: 24 }),
      makeGpuNode({ nodeId: 'n3', state: 'degraded', vramGb: 24 }),
      makeGpuNode({ nodeId: 'n4', state: 'unreachable', vramGb: 24 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.nodeCount).toBe(4);
    expect(cap.readyNodeCount).toBe(2);
  });

  it('sums vram across all nodes (not just usable) for vramTotalGb', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24 }),
      makeGpuNode({ nodeId: 'n2', state: 'degraded', vramGb: 24 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.vramTotalGb).toBe(48);
  });

  it('vramAvailableGb only counts ready/running nodes', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24 }),
      makeGpuNode({ nodeId: 'n2', state: 'degraded', vramGb: 24 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.vramAvailableGb).toBe(24);
  });

  it('counts GPU count including multi-GPU nodes', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24, gpuCount: 2 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 12, gpuCount: 1 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.gpuCount).toBe(3);
  });

  it('detects fp4Capable when any node has fp4Native GPU', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', vramGb: 24, fp4: false }),
      makeGpuNode({ nodeId: 'n2', vramGb: 128, fp4: true }),
    ];
    expect(computeCapacity(nodes).fp4Capable).toBe(true);
  });

  it('fp4Capable is false when no node has fp4Native GPU', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', vramGb: 24, fp4: false }),
    ];
    expect(computeCapacity(nodes).fp4Capable).toBe(false);
  });

  it('aggregates decodeTokS from metrics', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', vramGb: 24, decodeTokS: 20 }),
      makeGpuNode({ nodeId: 'n2', vramGb: 24, decodeTokS: 30 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.aggregateDecodeTokS).toBe(50);
  });

  it('skips decodeTokS for nodes with null metrics', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', vramGb: 24, decodeTokS: 30 }),
      makeGpuNode({ nodeId: 'n2', vramGb: 24 }), // metrics: null
    ];
    const cap = computeCapacity(nodes);
    expect(cap.aggregateDecodeTokS).toBe(30);
  });

  it('CPU-only node (no GPUs) uses ramTotalGb as vram=0 fallback', () => {
    // Exercises the `vram || n.profile.ramTotalGb` branch in nodeUsableGb
    const nodes: NodeView[] = [
      makeCpuNode({ nodeId: 'cpu-1', state: 'ready', ramTotalGb: 64 }),
      makeCpuNode({ nodeId: 'cpu-2', state: 'running', ramTotalGb: 32 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.nodeCount).toBe(2);
    expect(cap.readyNodeCount).toBe(2);
    expect(cap.vramTotalGb).toBe(0);
    expect(cap.gpuCount).toBe(0);
  });

  it('deduplicates backends across nodes', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', vramGb: 24 }), // backends: ['cuda', 'cpu']
      makeGpuNode({ nodeId: 'n2', vramGb: 24 }), // backends: ['cuda', 'cpu']
    ];
    const cap = computeCapacity(nodes);
    expect(cap.backends.filter((b) => b === 'cuda')).toHaveLength(1);
    expect(cap.backends.filter((b) => b === 'cpu')).toHaveLength(1);
  });

  it('sums ramAvailableGb from usable nodes only', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24, ramAvailableGb: 40 }),
      makeGpuNode({ nodeId: 'n2', state: 'running', vramGb: 24, ramAvailableGb: 30 }),
      makeGpuNode({ nodeId: 'n3', state: 'degraded', vramGb: 24, ramAvailableGb: 50 }),
    ];
    const cap = computeCapacity(nodes);
    expect(cap.ramAvailableGb).toBe(70);
    expect(cap.ramTotalGb).toBe(192); // all three nodes' ramTotalGb
  });
});

// ---------------------------------------------------------------------------
// computeFit
// ---------------------------------------------------------------------------

describe('computeFit', () => {
  it('returns no_ready_nodes when no usable nodes', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'degraded', vramGb: 200 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 10 }] });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(false);
    expect(fit.reasonKey).toBe('no_ready_nodes');
    expect(fit.quantization).toBeNull();
    expect(fit.estimated).toBeNull();
    expect(fit.deficitGb).toBe(10); // smallest quant size
  });

  it('returns needs_fp4 when only FP4-only quantizations and fleet lacks FP4', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200, fp4: false }),
    ];
    const model = makeModel({
      quants: [{ name: 'NVFP4', sizeGb: 50, fp4: true }],
    });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(false);
    expect(fit.reasonKey).toBe('needs_fp4');
    expect(fit.deficitGb).toBe(0);
  });

  it('returns not_enough_memory when model is too large', () => {
    const nodes: NodeView[] = [
      // usableGb = 24 * 0.85 = 20.4, not enough for 100 GB model
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 24 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 100 }] });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(false);
    expect(fit.reasonKey).toBe('not_enough_memory');
    expect(fit.deficitGb).toBeGreaterThan(0);
  });

  it('returns fits when model fits on available nodes', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 64 }),
    ];
    // 64 * 0.85 = 54.4 >= 10 GB quant
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 10 }] });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
    expect(fit.reasonKey).toBe('fits');
    expect(fit.quantization).toBe('Q4');
    expect(fit.nodesNeeded).toBe(1);
    expect(fit.estimated).not.toBeNull();
    expect(fit.deficitGb).toBe(0);
  });

  it('returns fits_tight when headroom is less than 6 GB', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 13 }),
    ];
    // 13 * 0.85 = 11.05. Quant = 10 GB. headroom = round(11.05 - 10) = 1 GB → tight
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 10 }] });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
    expect(fit.reasonKey).toBe('fits_tight');
  });

  it('uses default preference balanced when no overrides', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
    ];
    // Balanced: highest quality that fits (quality-first)
    const model = makeModel({
      quants: [
        { name: 'Q4_K_M', sizeGb: 43, quality: 0.93 },
        { name: 'Q8_0', sizeGb: 75, quality: 0.99 },
      ],
    });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
    expect(fit.quantization).toBe('Q8_0'); // highest quality
  });

  it('speed preference picks smallest footprint', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      quants: [
        { name: 'Q4_K_M', sizeGb: 43, quality: 0.93 },
        { name: 'Q8_0', sizeGb: 75, quality: 0.99 },
      ],
    });
    const fit = computeFit(model, nodes, { forceNodeCount: null, preference: 'speed' });
    expect(fit.quantization).toBe('Q4_K_M'); // smallest
  });

  it('quality preference picks highest quality', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      quants: [
        { name: 'Q4_K_M', sizeGb: 43, quality: 0.93 },
        { name: 'Q5_K_M', sizeGb: 50, quality: 0.95 },
      ],
    });
    const fit = computeFit(model, nodes, { forceNodeCount: null, preference: 'quality' });
    expect(fit.quantization).toBe('Q5_K_M');
  });

  it('forceNodeCount overrides automatic node selection', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n3', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 5 }] }); // fits on 1 node
    const fit = computeFit(model, nodes, { forceNodeCount: 3, preference: 'balanced' });
    expect(fit.nodesNeeded).toBe(3);
  });

  it('clamps forceNodeCount to usable node count', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'degraded', vramGb: 200 }), // not usable
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 5 }] });
    const fit = computeFit(model, nodes, { forceNodeCount: 5, preference: 'balanced' });
    // Only 1 usable node → clamped to 1
    expect(fit.nodesNeeded).toBe(1);
  });

  it('fp4 quant is selected when fleet has fp4 capability', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200, fp4: true }),
    ];
    const model = makeModel({
      quants: [
        { name: 'NVFP4', sizeGb: 50, fp4: true, quality: 0.97 },
        { name: 'Q4_K_M', sizeGb: 80, fp4: false, quality: 0.93 },
      ],
    });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
    // NVFP4 has higher quality and requiresFp4=true; fp4 is available
    expect(fit.quantization).toBe('NVFP4');
  });

  it('unified memory nodes avoid double-counting (uses max of vram/ram)', () => {
    // Unified GPU with vramGb=96 and ramTotalGb=96 → usableGb = 96 * 0.85
    const nodes: NodeView[] = [
      {
        profile: {
          nodeId: 'mac-1',
          hostname: 'mac-studio',
          os: 'darwin',
          arch: 'arm64',
          backends: ['metal', 'cpu'],
          gpus: [{ name: 'Apple M3 Ultra', vramGb: 96, unified: true, fp4Native: false, count: 1 }],
          ramTotalGb: 96,
          ramAvailableGb: 70,
          memBandwidthGbs: 819,
          diskFreeGb: 1500,
          engineVersions: {},
          lastSeen: new Date().toISOString(),
          state: 'ready',
        },
        metrics: null,
        role: null,
        linkQuality: 'good',
        deploymentId: null,
      },
    ];
    // 96 * 0.85 = 81.6 GB usable
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 70 }] });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
  });

  it('estimated perf has correct range ordering (min <= max)', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      quants: [{ name: 'Q4', sizeGb: 20 }],
      paramsTotalB: 70,
      paramsActiveB: 70,
    });
    const fit = computeFit(model, nodes);
    expect(fit.fits).toBe(true);
    const est = fit.estimated!;
    expect(est.decodeTokSMin).toBeLessThanOrEqual(est.decodeTokSMax);
    expect(est.prefillTokSMin).toBeLessThanOrEqual(est.prefillTokSMax);
    expect(est.headroomGb).toBeGreaterThanOrEqual(0);
  });

  it('empty nodes returns reasonKey no_ready_nodes', () => {
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 10 }] });
    const fit = computeFit(model, []);
    expect(fit.reasonKey).toBe('no_ready_nodes');
    expect(fit.nodesNeeded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCatalog
// ---------------------------------------------------------------------------

describe('buildCatalog', () => {
  it('returns one entry per model', () => {
    const nodes: NodeView[] = [makeGpuNode({ vramGb: 200, state: 'ready' })];
    const models: ModelSpec[] = [
      makeModel({ modelId: 'm1', quants: [{ name: 'Q4', sizeGb: 5 }] }),
      makeModel({ modelId: 'm2', quants: [{ name: 'Q4', sizeGb: 5 }] }),
    ];
    const catalog = buildCatalog(models, nodes);
    expect(catalog).toHaveLength(2);
    expect(catalog[0].model.modelId).toBe('m1');
    expect(catalog[1].model.modelId).toBe('m2');
  });

  it('each entry has a .model and .fit', () => {
    const nodes: NodeView[] = [makeGpuNode({ vramGb: 200, state: 'ready' })];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 5 }] });
    const [entry] = buildCatalog([model], nodes);
    expect(entry.model).toBe(model);
    expect(entry.fit).toBeDefined();
    expect(typeof entry.fit.fits).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// buildPlan
// ---------------------------------------------------------------------------

describe('buildPlan', () => {
  const singleNode: NodeView[] = [
    makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200, linkQuality: 'good' }),
  ];

  it('produces a plan for a simple single-node model', () => {
    const model = makeModel({
      modelId: 'small-model',
      layers: 32,
      quants: [{ name: 'Q4', sizeGb: 5 }],
    });
    const plan = buildPlan(model, singleNode, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.modelId).toBe('small-model');
    expect(plan.planId).toMatch(/^plan-small-model-/);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].nodeId).toBe('n1');
    expect(plan.assignments[0].role).toBe('host');
    expect(plan.assignments[0].layerStart).toBe(0);
    expect(plan.assignments[0].layerEnd).toBe(32);
    expect(plan.pipelineOrder).toEqual(['n1']);
  });

  it('cost calculation uses .toFixed(2) — format is deterministic', () => {
    const model = makeModel({
      modelId: 'cost-test',
      quants: [{ name: 'Q4', sizeGb: 100 }],
    });
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
    ];
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    // cost = (100/100 + 1*0.2).toFixed(2) = "1.20" = 1.2
    expect(plan.cost).toBe(1.20);
    // Verify it's a number with at most 2 decimal places
    expect(Number.isFinite(plan.cost)).toBe(true);
    expect(Math.round(plan.cost * 100) / 100).toBe(plan.cost);
  });

  it('pipeline host is the node with excellent link quality', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 100, linkQuality: 'good' }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 100, linkQuality: 'excellent' }),
    ];
    const model = makeModel({
      quants: [{ name: 'Q4', sizeGb: 50 }],
      layers: 40,
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    // n2 has excellent link quality → it should be first in pipelineOrder
    expect(plan.pipelineOrder[0]).toBe('n2');
    expect(plan.assignments[0].nodeId).toBe('n2');
    expect(plan.assignments[0].role).toBe('host');
  });

  it('first node is host, remaining are workers in multi-node plan', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 100 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 100 }),
    ];
    const model = makeModel({
      quants: [{ name: 'Q4', sizeGb: 50 }],
      layers: 40,
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    expect(plan.assignments[0].role).toBe('host');
    expect(plan.assignments[1].role).toBe('worker');
  });

  it('layer assignments cover all layers (sum of layerEnd - layerStart = totalLayers)', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      layers: 80,
      quants: [{ name: 'Q4', sizeGb: 50 }],
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    const totalLayers = plan.assignments.reduce((s, a) => s + (a.layerEnd - a.layerStart), 0);
    expect(totalLayers).toBe(80);
  });

  it('layer assignments are non-overlapping and sequential', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      layers: 80,
      quants: [{ name: 'Q4', sizeGb: 50 }],
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    let cursor = 0;
    for (const a of plan.assignments) {
      expect(a.layerStart).toBe(cursor);
      expect(a.layerEnd).toBeGreaterThan(a.layerStart);
      cursor = a.layerEnd;
    }
    expect(cursor).toBe(80);
  });

  it('MoE model explanation mentions active params', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 })];
    const model = makeModel({
      paramsTotalB: 235,
      paramsActiveB: 22,
      quants: [{ name: 'Q4', sizeGb: 50 }],
      isMoe: true,
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.explanation.some((s) => s.includes('22'))).toBe(true);
    expect(plan.explanation.some((s) => s.includes('MoE'))).toBe(true);
  });

  it('draft model explanation mentions speculative decoding', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 })];
    const model = makeModel({
      quants: [{ name: 'Q4', sizeGb: 5 }],
      draftAvailable: true,
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.explanation.some((s) => s.toLowerCase().includes('speculative'))).toBe(true);
  });

  it('draft enabled only on host node (index 0)', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({
      quants: [{ name: 'Q4', sizeGb: 50 }],
      draftAvailable: true,
      layers: 40,
    });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    expect(plan.assignments[0].draft).toBe(true);
    expect(plan.assignments[1].draft).toBe(false);
  });

  it('plan has pipelineOrder with same length as assignments', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 50 }], layers: 40 });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    expect(plan.pipelineOrder).toHaveLength(plan.assignments.length);
  });

  it('estimated perf field is present in the plan', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 })];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 10 }] });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.estimated).not.toBeNull();
    expect(plan.estimated.decodeTokSMin).toBeGreaterThan(0);
  });

  it('buildPlan with infeasible model uses smallest quant name as fallback', () => {
    // Exercises `fit.quantization ?? smallestQuant(model).name` branch
    // When the model doesn't fit, fit.quantization=null, so buildPlan falls back to smallestQuant
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 5 }),
    ];
    // 5 * 0.85 = 4.25 GB usable. Model smallest quant = 50 GB → doesn't fit
    const model = makeModel({
      modelId: 'huge-model',
      quants: [
        { name: 'Q4_K_M', sizeGb: 50, quality: 0.93 },
        { name: 'Q3', sizeGb: 40, quality: 0.88 },
      ],
      layers: 32,
    });
    // buildPlan calls computeFit which returns fits:false, quantization:null
    // Then it uses smallestQuant(model).name = 'Q3'
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.quantization).toBe('Q3'); // smallest quant fallback
    expect(plan.modelId).toBe('huge-model');
  });

  it('buildPlan with FP4 quant includes FP4 explanation', () => {
    // Exercises the `if (quant.requiresFp4)` branch in buildPlan explanation
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200, fp4: true }),
    ];
    const model: ModelSpec = {
      modelId: 'fp4-model',
      family: 'FP4 Test',
      architecture: 'LlamaForCausalLM',
      paramsTotalB: 70,
      paramsActiveB: 70,
      layers: 32,
      hiddenSize: 4096,
      nKvHeads: 8,
      headDim: 128,
      attentionType: 'gqa',
      contextMax: 8192,
      isMoe: false,
      draft: { available: false, type: '', tailLayers: 0 },
      engine: 'llama.cpp',
      quantizations: [
        { name: 'NVFP4', sizeGb: 50, requiresFp4: true, quality: 0.97, emulatedFp4: false },
      ],
    };
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.quantization).toBe('NVFP4');
    expect(plan.explanation.some((s) => s.includes('FP4'))).toBe(true);
  });

  it('single-node plan has only the host node in assignments', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'solo', state: 'ready', vramGb: 200 })];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 5 }], layers: 10 });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].role).toBe('host');
  });
});

// ---------------------------------------------------------------------------
// planToDeployment
// ---------------------------------------------------------------------------

describe('planToDeployment', () => {
  it('creates a deployment with provisioning state', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 })];
    const model = makeModel({ modelId: 'dep-model', quants: [{ name: 'Q4', sizeGb: 5 }] });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    const dep = planToDeployment(plan);
    expect(dep.state).toBe('provisioning');
    expect(dep.id).toBe(`dep-dep-model`);
    expect(dep.plan).toBe(plan);
  });

  it('all nodeStatus entries start as loading with progress=0', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'n2', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 50 }], layers: 40 });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    const dep = planToDeployment(plan);
    expect(dep.nodeStatus).toHaveLength(plan.assignments.length);
    for (const ns of dep.nodeStatus) {
      expect(ns.state).toBe('loading');
      expect(ns.progress).toBe(0);
    }
  });

  it('createdAt is a valid ISO timestamp', () => {
    const nodes: NodeView[] = [makeGpuNode({ nodeId: 'n1', state: 'ready', vramGb: 200 })];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 5 }] });
    const plan = buildPlan(model, nodes, { forceNodeCount: null, preference: 'balanced' });
    const dep = planToDeployment(plan);
    expect(() => new Date(dep.createdAt)).not.toThrow();
    expect(new Date(dep.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('nodeStatus nodeIds match the plan assignment nodeIds', () => {
    const nodes: NodeView[] = [
      makeGpuNode({ nodeId: 'nodeA', state: 'ready', vramGb: 200 }),
      makeGpuNode({ nodeId: 'nodeB', state: 'ready', vramGb: 200 }),
    ];
    const model = makeModel({ quants: [{ name: 'Q4', sizeGb: 50 }], layers: 40 });
    const plan = buildPlan(model, nodes, { forceNodeCount: 2, preference: 'balanced' });
    const dep = planToDeployment(plan);
    const planNodeIds = plan.assignments.map((a) => a.nodeId);
    const depNodeIds = dep.nodeStatus.map((s) => s.nodeId);
    expect(depNodeIds).toEqual(planNodeIds);
  });
});
