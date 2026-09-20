/**
 * Shared cluster-health cards — rendered on the Dashboard (and nowhere else).
 *
 * Extracted from FleetPage (v0.7 W2 dashboard refactor) so that Dashboard can
 * show cluster health without duplicating the components.
 *
 * Each card is self-contained: it calls its own hooks and owns its loading /
 * error states, keeping callers free of boilerplate.
 */
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Meter,
  type Tone,
} from '../ui';
import {
  useClusterStatus,
  useSloComplianceFull,
  type ReconcilerStatus,
} from '../../hooks/queries';
import { useT, type TFunc } from '../../i18n';
import { tokS } from '../../lib/format';
import { errorMessage } from '../../lib/errors';
import type { ClusterCapacity, ClusterStatus, SloModelEntry } from '../../api/types';

// ---------------------------------------------------------------------------
// CapacityCard
// ---------------------------------------------------------------------------

export function CapacityCard({
  cap,
  liveDecodeTokS,
}: {
  cap: ClusterCapacity;
  liveDecodeTokS?: number;
}) {
  const t = useT();
  // Prefer the live SSE aggregate when a metrics stream is active.
  const decode = liveDecodeTokS ?? cap.aggregateDecodeTokS;
  return (
    <Card title={t('fleet.capacity.title')}>
      <p className="muted capacity__hint">{t('fleet.capacity.hint')}</p>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat__value">
            {cap.readyNodeCount}
            <span className="stat__sub">
              {' '}
              {t('common.of')} {cap.nodeCount}
            </span>
          </span>
          <span className="stat__label">{t('fleet.capacity.nodes')}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{cap.gpuCount}</span>
          <span className="stat__label">{t('fleet.capacity.gpus')}</span>
        </div>
        <div className="stat">
          <span className="stat__value" aria-live="polite">{tokS(decode)}</span>
          <span className="stat__label">{t('fleet.capacity.throughput')}</span>
        </div>
        <div
          className="stat"
          title="FP4 (4-bit floating point) quantization acceleration. Reduces memory usage and increases throughput on compatible hardware."
        >
          <span className="stat__value">
            <Badge tone={cap.fp4Capable ? 'success' : 'neutral'}>
              {cap.fp4Capable ? t('fleet.capacity.fp4.yes') : t('fleet.capacity.fp4.no')}
            </Badge>
          </span>
          <span className="stat__label">{t('fleet.capacity.fp4')}</span>
        </div>
      </div>
      <div className="capacity__meters">
        {cap.ramTotalGb !== null ? (
          <Meter
            used={(cap.ramTotalGb ?? 0) - (cap.ramAvailableGb ?? 0)}
            total={cap.ramTotalGb ?? 0}
            label={t('fleet.capacity.ram')}
          />
        ) : (
          <div className="meter">
            <div className="meter__row">
              <span className="meter__label">{t('fleet.capacity.ram')}</span>
              <span className="meter__value muted">{t('common.notMeasured')}</span>
            </div>
          </div>
        )}
        {cap.vramTotalGb !== null ? (
          <Meter
            used={(cap.vramTotalGb ?? 0) - (cap.vramAvailableGb ?? 0)}
            total={cap.vramTotalGb ?? 0}
            label={t('fleet.capacity.vram')}
          />
        ) : (
          <div className="meter">
            <div className="meter__row">
              <span className="meter__label">{t('fleet.capacity.vram')}</span>
              <span className="meter__value muted">{t('common.notMeasured')}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ReconcilerStatusCard
//
// Shows the control-plane reconciler health status. Handles three states:
//   - loading  → render nothing while the first fetch is in-flight
//   - error    → neutral "Status unknown" badge
//   - data     → state badge + pending/error counts + active event list +
//                collapsible configuration panel with fixed grid layout.
//
// CSS fix (W2): the "Configuration" detail panel now uses an explicit CSS grid
// (gridTemplateColumns: max-content 1fr) to prevent key/value pairs from
// wrapping mid-line on longer values.
// ---------------------------------------------------------------------------

export function ReconcilerStatusCard({
  status,
}: {
  status: ReconcilerStatus | undefined;
}) {
  const STATE_TONE: Record<ReconcilerStatus['state'], Tone> = {
    idle: 'success',
    syncing: 'info',
    error: 'danger',
  };

  if (!status) {
    return (
      <Card title="Reconciler">
        <p>
          <Badge tone="neutral">Status unknown</Badge>
          {' '}
          Reconciler status unknown
        </p>
      </Card>
    );
  }

  // Active tracker events: only event types that currently have tracked > 0.
  const activeEvents = Object.entries(status.tracker).filter(([, v]) => v.tracked > 0);

  return (
    <Card title="Reconciler">
      <div className="stat-grid">
        <div className="stat">
          <span className="stat__value">
            <Badge tone={STATE_TONE[status.state]}>{status.state}</Badge>
          </span>
          <span className="stat__label">State</span>
        </div>
        <div className="stat">
          <span className="stat__value">{status.pendingCount}</span>
          <span className="stat__label">Pending</span>
        </div>
        <div className="stat">
          <span className="stat__value">{status.errorCount}</span>
          <span className="stat__label">Errors</span>
        </div>
      </div>

      {activeEvents.length > 0 && (
        <div className="reconciler__events">
          <p className="muted">Active events</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Event type</th>
                  <th scope="col">Tracked</th>
                  <th scope="col">Age (s)</th>
                </tr>
              </thead>
              <tbody>
                {activeEvents.map(([type, v]) => (
                  <tr key={type}>
                    <td><code>{type}</code></td>
                    <td>{v.tracked}</td>
                    <td>{v.oldestAgeS.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CSS grid layout prevents key/value pairs from wrapping mid-line */}
      <details className="reconciler__config">
        <summary className="muted">Configuration</summary>
        <dl
          className="reconciler__config-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: '20px',
            rowGap: '6px',
            margin: 0,
          }}
        >
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 500 }}>Interval</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.85em', whiteSpace: 'nowrap' }} data-testid="cfg-interval">{status.config.intervalS}s</dd>
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 500 }}>Node timeout</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.85em', whiteSpace: 'nowrap' }} data-testid="cfg-node-timeout">{status.config.nodeTimeoutS}s</dd>
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 500 }}>Hysteresis</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>{status.config.hysteresisS}s</dd>
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 500 }}>Action cooldown</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>{status.config.actionCooldownS}s</dd>
        </dl>
      </details>

      {status.lastSyncAt && (
        <p className="muted">
          Last sync:{' '}
          <time dateTime={status.lastSyncAt}>
            {new Date(status.lastSyncAt).toLocaleString()}
          </time>
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HA / Raft cluster status card
// ---------------------------------------------------------------------------

const RAFT_STATE_TONE: Record<string, Tone> = {
  Leader: 'success',
  Follower: 'info',
  Candidate: 'warning',
  Shutdown: 'danger',
};

export function ClusterStatusCard() {
  const t = useT();
  const { data, isLoading, isError } = useClusterStatus();

  if (isLoading) {
    return (
      <Card title={t('clusterStatus.title')}>
        <LoadingBlock />
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card title={t('clusterStatus.title')}>
        <p>
          <Badge tone="neutral">{t('clusterStatus.unknown')}</Badge>{' '}
          <span className="muted">{t('clusterStatus.unknownHint')}</span>
        </p>
      </Card>
    );
  }

  return <ClusterStatusBody status={data} t={t} />;
}

function ClusterStatusBody({ status, t }: { status: ClusterStatus; t: TFunc }) {
  // Standalone (single-node, no HA) — a normal, non-error state.
  if (status.mode === 'standalone') {
    return (
      <Card title={t('clusterStatus.title')}>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat__value">
              <Badge tone="neutral">{t('clusterStatus.standalone')}</Badge>
            </span>
            <span className="stat__label">{t('clusterStatus.stat.mode')}</span>
          </div>
          <div className="stat">
            <span className="stat__value">
              <Badge tone="success">{t('clusterStatus.thisLeader')}</Badge>
            </span>
            <span className="stat__label">{t('clusterStatus.stat.thisNode')}</span>
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>{t('clusterStatus.standaloneHint')}</p>
      </Card>
    );
  }

  // Raft mode — surface leader, state, and peer count.
  const stateStr = status.state ?? '';
  const peers = status.stats?.numPeers ?? status.stats?.numVoters;
  const peerCount = peers !== undefined ? Number(peers) : undefined;
  // hashicorp/raft's num_peers excludes the local node; total members = peers + 1.
  const members = peerCount !== undefined && isFinite(peerCount) ? peerCount + 1 : undefined;
  const statEntries = status.stats ? Object.entries(status.stats) : [];

  return (
    <Card title={t('clusterStatus.title')}>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat__value">
            <Badge tone={RAFT_STATE_TONE[stateStr] ?? 'neutral'}>
              {stateStr || t('clusterStatus.stat.state')}
            </Badge>
          </span>
          <span className="stat__label">{t('clusterStatus.stat.state')}</span>
        </div>
        {members !== undefined && (
          <div className="stat">
            <span className="stat__value">{members}</span>
            <span className="stat__label">{t('clusterStatus.stat.members')}</span>
          </div>
        )}
        {peerCount !== undefined && (
          <div className="stat">
            <span className="stat__value">{peerCount}</span>
            <span className="stat__label">{t('clusterStatus.stat.peers')}</span>
          </div>
        )}
      </div>

      {status.leader && (
        <p className="muted">
          {t('clusterStatus.stat.leader')}:{' '}
          <code className="inline-code" style={{ fontSize: '0.85em' }}>{status.leader}</code>
        </p>
      )}

      {statEntries.length > 0 && (
        <details className="reconciler__config">
          <summary className="muted">{t('clusterStatus.stats')}</summary>
          <dl
            className="reconciler__config-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              columnGap: '20px',
              rowGap: '6px',
              margin: 0,
            }}
          >
            {statEntries.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 500 }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85em' }}>{k}</code>
                </dt>
                <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85em' }}>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <p className="muted" style={{ marginBottom: 0 }}>{t('clusterStatus.raftHint')}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SLO Status card
// ---------------------------------------------------------------------------

const SLO_TONE: Record<SloModelEntry['status'], Tone> = {
  met: 'success',
  breached: 'danger',
  insufficient_data: 'neutral',
};

export function SloStatusCard() {
  const t = useT();
  const { data, isLoading, isError, error } = useSloComplianceFull(24);

  return (
    <Card title={t('slo.title')}>
      {isLoading && <LoadingBlock />}
      {isError && (
        <ErrorState message={errorMessage(error, t, 'error.slo')} />
      )}
      {data && data.models.length === 0 && (
        <EmptyState message={t('slo.empty')} />
      )}
      {data && data.models.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="slo-table">
            <thead>
              <tr>
                <th scope="col">{t('slo.col.model')}</th>
                <th scope="col">{t('slo.col.ttftTarget')}</th>
                <th scope="col">{t('slo.col.compliance')}</th>
                <th scope="col">{t('slo.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.model_id}>
                  <td>{m.model_id}</td>
                  <td>{m.slo.ttft_ms}</td>
                  <td>
                    {m.actual.ttft_compliance !== null
                      ? `${(m.actual.ttft_compliance * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td>
                    <Badge tone={SLO_TONE[m.status]}>
                      {m.status === 'met'
                        ? t('slo.status.met')
                        : m.status === 'breached'
                          ? t('slo.status.breached')
                          : t('slo.status.insufficientData')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

