import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusPill,
  type Tone,
} from '../components/ui';
import { IconServer } from '../components/icons';
import {
  useCapacity,
  useMetricsStream,
  useNodes,
  useNodeAction,
} from '../hooks/queries';
import { useT, type TFunc } from '../i18n';
import { gb, tokS } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { EngineMetrics, LinkQuality, NodeView } from '../api/types';

const LINK_TONE: Record<LinkQuality, Tone> = {
  excellent: 'success',
  good: 'success',
  fair: 'warning',
  poor: 'danger',
  unknown: 'neutral',
};

function hardwareSummary(n: NodeView): string {
  const gpus = n.profile.gpus ?? [];
  const gpu =
    gpus.length > 0
      ? gpus.map((g) => `${g.count}× ${g.name} (${g.vramGb}GB)`).join(', ')
      : 'CPU only';
  const backends = n.profile.backends ?? [];
  return `${gpu} · ${gb(n.profile.ramTotalGb)} RAM${backends.length > 0 ? ` · ${backends.join('/')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Node expanded details panel — shown as an accordion row below the node row.
// Design: datasheet-insert style. Small muted labels, monospace for technical
// values. var(--surface-2) background so it reads as "inside" the parent row.
// ---------------------------------------------------------------------------

function NodeDetailPanel({ node, t }: { node: NodeView; t: TFunc }) {
  const engines = Object.entries(node.profile.engineVersions);
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
        margin: '4px 0',
      }}
    >
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: '20px',
          rowGap: '6px',
          margin: 0,
        }}
      >
        {/* Node ID */}
        <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
          Node ID
        </dt>
        <dd style={{ margin: 0 }}>
          <code className="inline-code" style={{ fontSize: '0.85em' }}>
            {node.profile.nodeId}
          </code>
        </dd>

        {/* Hostname */}
        <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
          Hostname
        </dt>
        <dd style={{ margin: 0, fontWeight: 500 }}>{node.profile.hostname}</dd>

        {/* OS / Arch */}
        <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
          Platform
        </dt>
        <dd style={{ margin: 0 }}>
          <code className="inline-code" style={{ fontSize: '0.85em' }}>
            {node.profile.os}/{node.profile.arch}
          </code>
        </dd>

        {/* RAM */}
        <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
          RAM
        </dt>
        <dd style={{ margin: 0 }}>
          <span style={{ fontWeight: 500 }}>{gb(node.profile.ramAvailableGb)}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875em' }}>
            {' '}available / {gb(node.profile.ramTotalGb)} total
          </span>
        </dd>

        {/* Link quality */}
        <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
          {t('fleet.col.link')}
        </dt>
        <dd style={{ margin: 0 }}>
          <Badge tone={LINK_TONE[node.linkQuality]}>{node.linkQuality}</Badge>
        </dd>

        {/* Last seen */}
        {node.profile.lastSeen && (
          <>
            <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
              Last seen
            </dt>
            <dd style={{ margin: 0, fontSize: '0.875em', color: 'var(--text-muted)' }}>
              <time dateTime={node.profile.lastSeen}>
                {new Date(node.profile.lastSeen).toLocaleString()}
              </time>
            </dd>
          </>
        )}

        {/* Inference engines */}
        {engines.length > 0 && (
          <>
            <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'flex-start', fontWeight: 600, paddingTop: '2px' }}>
              Engines
            </dt>
            <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {engines.map(([engine, version]) => (
                <span
                  key={engine}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px 8px',
                    fontSize: '0.8em',
                  }}
                >
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{engine}</code>
                  <span style={{ color: 'var(--text-muted)' }}>{version}</span>
                </span>
              ))}
            </dd>
          </>
        )}

        {/* Advertised agent addr */}
        {node.profile.advertisedAgentAddr && (
          <>
            <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
              Agent addr
            </dt>
            <dd style={{ margin: 0 }}>
              <code className="inline-code" style={{ fontSize: '0.85em' }}>
                {node.profile.advertisedAgentAddr}
              </code>
            </dd>
          </>
        )}

        {/* Advertised inference addr */}
        {node.profile.advertisedInferenceAddr && (
          <>
            <dt style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>
              Inference addr
            </dt>
            <dd style={{ margin: 0 }}>
              <code className="inline-code" style={{ fontSize: '0.85em' }}>
                {node.profile.advertisedInferenceAddr}
              </code>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overflow action menu — ⋮ button that expands Drain / Restart / Remove.
// Danger actions (Drain, Remove) use var(--danger-fg). A visual separator sits
// between the neutral Restart and the destructive Remove to create a natural
// pause before the irreversible actions.
// ---------------------------------------------------------------------------

function NodeActionMenu({
  id,
  busy,
  onDrain,
  onRestart,
  onRemove,
  t,
}: {
  id: string;
  busy: boolean;
  onDrain: () => void;
  onRestart: () => void;
  onRemove: () => void;
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);

  const menuItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875em',
    color: 'var(--text)',
    fontFamily: 'inherit',
  };

  const dangerItemStyle: React.CSSProperties = {
    ...menuItemStyle,
    color: 'var(--danger-fg)',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('fleet.col.actions') + ' ' + id}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1 }}
      >
        ⋮
      </Button>
      {open && (
        <>
          {/* Transparent overlay to close menu on outside click */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <ul
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: '4px',
              zIndex: 11,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)',
              padding: '4px 0',
              minWidth: '148px',
              listStyle: 'none',
              margin: '4px 0 0 0',
            }}
          >
            <li>
              <button
                role="menuitem"
                style={dangerItemStyle}
                onClick={() => { setOpen(false); onDrain(); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--danger-bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {t('fleet.action.drain')}
              </button>
            </li>
            <li>
              <button
                role="menuitem"
                style={menuItemStyle}
                onClick={() => { setOpen(false); onRestart(); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {t('fleet.action.restart')}
              </button>
            </li>
            {/* Visual separator before the destructive Remove action */}
            <li role="separator" style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
            <li>
              <button
                role="menuitem"
                style={dangerItemStyle}
                onClick={() => { setOpen(false); onRemove(); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--danger-bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {t('fleet.action.remove')}
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

function NodeRow({
  node,
  liveMetrics,
  isExpanded,
  onToggle,
  t,
}: {
  node: NodeView;
  /** Live hardware metrics from the SSE stream; null if the node has not yet reported. */
  liveMetrics: EngineMetrics | null;
  isExpanded: boolean;
  onToggle: () => void;
  t: TFunc;
}) {
  const { drain, restart, remove } = useNodeAction();
  const id = node.profile.nodeId;
  const busy = drain.isPending || restart.isPending || remove.isPending;
  // Prefer SSE live data; fall back to REST snapshot metrics.
  const metrics = liveMetrics ?? node.metrics;
  const [showDrainModal, setShowDrainModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  const isRetired = node.profile.state === 'decommissioned';

  return (
    <>
      <tr style={isRetired ? { opacity: 0.55 } : undefined}>
        <th
          scope="row"
          className="node-cell"
          onClick={onToggle}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          aria-expanded={isExpanded}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '1em',
              marginRight: '6px',
              fontSize: '0.7em',
              color: 'var(--text-muted)',
              transition: 'transform 150ms ease',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
          <span className="node-cell__host">{node.profile.hostname}</span>
          <span className="node-cell__meta">
            {node.profile.os}/{node.profile.arch}
            {node.role && (
              <>
                {' · '}
                <Badge tone="info">{node.role === 'host' ? t('fleet.role.host') : t('fleet.role.worker')}</Badge>
              </>
            )}
            {node.profile.gpus?.some((g) => g.fp4Native) && <Badge tone="success">FP4</Badge>}
          </span>
        </th>
        <td>
          <StatusPill state={node.profile.state} />
          {isRetired && (
            <span
              className="muted"
              title={t('fleet.node.retired.hint')}
              style={{ marginLeft: '0.4rem', fontSize: '0.75rem', cursor: 'help' }}
            >
              {t('fleet.node.retired')}
            </span>
          )}
        </td>
        <td className="hw-cell">{hardwareSummary(node)}</td>
        <td>
          {metrics ? (
            <div className="load-cell">
              <span>{tokS(metrics.decodeTokS)}</span>
              <span className="muted">queue {metrics.queueDepth}</span>
            </div>
          ) : (
            <span className="muted">{t('common.na')}</span>
          )}
        </td>
        <td>
          <span title="Network link quality measured as round-trip latency to the control plane">
            <Badge tone={LINK_TONE[node.linkQuality]}>{node.linkQuality}</Badge>
          </span>
        </td>
        <td>
          <NodeActionMenu
            id={id}
            busy={busy}
            onDrain={() => setShowDrainModal(true)}
            onRestart={() => restart.mutate(id)}
            onRemove={() => setShowRemoveModal(true)}
            t={t}
          />
        </td>
      </tr>

      {/* Accordion details row */}
      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: '0 8px 8px 8px', borderTop: 0 }}>
            <NodeDetailPanel node={node} t={t} />
          </td>
        </tr>
      )}

      {/* Drain confirmation modal */}
      {showDrainModal && (
        <Modal
          title={t('fleet.confirm.drainTitle')}
          onClose={() => setShowDrainModal(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowDrainModal(false)}>
                {t('action.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  drain.mutate(id);
                  setShowDrainModal(false);
                }}
              >
                {t('fleet.action.drain')}
              </Button>
            </>
          }
        >
          {t('fleet.confirm.drainBody', { node: id })}
        </Modal>
      )}

      {/* Remove confirmation modal */}
      {showRemoveModal && (
        <Modal
          title={t('fleet.confirm.removeTitle')}
          onClose={() => setShowRemoveModal(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowRemoveModal(false)}>
                {t('action.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  remove.mutate(id);
                  setShowRemoveModal(false);
                }}
              >
                {t('fleet.action.remove')}
              </Button>
            </>
          }
        >
          {t('fleet.confirm.removeBody', { node: id })}
        </Modal>
      )}
    </>
  );
}

export function FleetPage() {
  const t = useT();
  const capacity = useCapacity();
  const nodes = useNodes();
  // Live hardware metrics via GET /api/v1/metrics (SSE). null until the first
  // frame arrives; each frame carries per-node engine metrics from heartbeats.
  const { snapshot: live, streamError } = useMetricsStream();

  // Single expanded node at a time — toggling the same row collapses it.
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  // Build a fast lookup: nodeId → live EngineMetrics from the SSE stream.
  // When a node has not yet reported, its entry is absent and NodeRow falls
  // back to the REST snapshot metrics (or shows n/a).
  const liveByNode: Record<string, EngineMetrics> = {};
  if (live?.nodes) {
    for (const sample of live.nodes) {
      // Zero-metric nodes (not yet reported) produce all-zero metrics objects.
      // Only expose them as live data when at least one metric is non-zero,
      // so the fallback to REST data is used for truly silent nodes.
      const m = sample.metrics;
      if (m.decodeTokS > 0 || m.prefillTokS > 0 || m.ramUsedGb > 0 || m.vramUsedGb > 0) {
        liveByNode[sample.nodeId] = m;
      }
    }
  }

  return (
    <div className="page">
      <PageHeader title={t('fleet.title')} subtitle={t('fleet.subtitle')} />
      {streamError && (
        <Badge tone="warning">{t('fleet.metrics.stale')}</Badge>
      )}

      {/* Idle anchor: nodes are ready but nothing is running. Guide the operator. */}
      {capacity.data &&
        capacity.data.readyNodeCount > 0 &&
        (live?.aggregateDecodeTokS ?? capacity.data.aggregateDecodeTokS) === 0 && (
          <div
            data-testid="fleet-idle-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: 'var(--info-bg)',
              border: '1px solid color-mix(in srgb, var(--info-fg) 25%, transparent)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
              fontSize: '0.9em',
            }}
          >
            <span aria-hidden="true" style={{ color: 'var(--info-fg)', fontSize: '1.1em' }}>ℹ</span>
            <span style={{ color: 'var(--text)' }}>
              {t('fleet.idle.banner')}{' '}
              <Link
                to="/catalog"
                style={{ color: 'var(--info-fg)', fontWeight: 600, textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--info-fg) 40%, transparent)' }}
              >
                {t('fleet.idle.link')}
              </Link>
            </span>
          </div>
        )}

      <Card title={t('fleet.title')}>
        {nodes.isLoading && <LoadingBlock />}
        {nodes.isError && (
          <ErrorState
            message={errorMessage(nodes.error, t, 'error.fleet')}
            onRetry={() => nodes.refetch()}
          />
        )}
        {nodes.data && nodes.data.length === 0 && (
          <EmptyState
            icon={<IconServer />}
            message={t('fleet.empty')}
            action={
              <Link to="/onboarding" className="btn btn--primary btn--sm link-btn">
                {t('nav.onboarding')}
              </Link>
            }
          />
        )}
        {nodes.data && nodes.data.length > 0 && (() => {
          // Sort: ready/running/degraded first; decommissioned/unreachable last.
          // Operate on a copy — never mutate the query-cache reference.
          const NODE_ORDER: Record<string, number> = {
            ready: 0,
            running: 0,
            degraded: 1,
            unreachable: 2,
            decommissioned: 3,
          };
          const sorted = [...nodes.data].sort(
            (a, b) =>
              (NODE_ORDER[a.profile.state] ?? 1) - (NODE_ORDER[b.profile.state] ?? 1),
          );
          const readyCount = nodes.data.filter((n) => n.profile.state === 'ready').length;
          return (
            <>
              <p
                className="table-caption muted"
                style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}
              >
                {t('fleet.nodes.readyOf', { ready: readyCount, total: nodes.data.length })}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('fleet.col.node')}</th>
                      <th scope="col">{t('fleet.col.state')}</th>
                      <th scope="col">{t('fleet.col.hardware')}</th>
                      <th scope="col">{t('fleet.col.load')}</th>
                      <th scope="col">{t('fleet.col.link')}</th>
                      <th scope="col">{t('fleet.col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((n) => (
                      <NodeRow
                        key={n.profile.nodeId}
                        node={n}
                        liveMetrics={liveByNode[n.profile.nodeId] ?? null}
                        isExpanded={expandedNodeId === n.profile.nodeId}
                        onToggle={() =>
                          setExpandedNodeId(
                            expandedNodeId === n.profile.nodeId ? null : n.profile.nodeId,
                          )
                        }
                        t={t}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </Card>
    </div>
  );
}
