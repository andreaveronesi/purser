/**
 * Dashboard — the landing page (/).
 *
 * Shows cluster health at a glance and a prominent fleet-summary box that links
 * to /fleet. The cluster-health cards (capacity, reconciler, HA status, SLO) are
 * rendered from the shared `components/cluster/ClusterCards` module so they are
 * not duplicated between this page and any future consumer.
 *
 * W2 (v0.7): DashboardPage replaces OnboardingPage as the index route. Onboarding
 * is now a dedicated route at /onboarding.
 */
import { Link } from 'react-router-dom';
import { ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import {
  CapacityCard,
  ReconcilerStatusCard,
  ClusterStatusCard,
  SloStatusCard,
} from '../components/cluster/ClusterCards';
import {
  useCapacity,
  useReconcilerStatus,
  useMetricsStream,
} from '../hooks/queries';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';

export function DashboardPage() {
  const t = useT();
  const capacity = useCapacity();
  const reconcilerStatus = useReconcilerStatus();
  const { snapshot: live } = useMetricsStream();

  return (
    <div className="page">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      {/* Fleet summary — prominent, clickable link to the Fleet page */}
      <Link
        to="/fleet"
        aria-label={t('dashboard.fleet.label')}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '16px 20px',
            cursor: 'pointer',
            transition: 'border-color 150ms ease',
          }}
          data-testid="dashboard-fleet-summary"
        >
          <div>
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: '1.05em',
              }}
            >
              {capacity.data
                ? t('fleet.nodes.readyOf', {
                    ready: capacity.data.readyNodeCount,
                    total: capacity.data.nodeCount,
                  })
                : t('dashboard.fleet.loading')}
            </p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.875em' }}>
              {t('dashboard.fleet.hint')}
            </p>
          </div>
          <span
            aria-hidden="true"
            style={{ color: 'var(--text-muted)', fontSize: '1.2em', marginLeft: '12px' }}
          >
            →
          </span>
        </div>
      </Link>

      {/* Cluster health: capacity, reconciler, HA status, SLO */}
      {capacity.isLoading && <LoadingBlock />}
      {capacity.isError && (
        <ErrorState
          message={errorMessage(capacity.error, t, 'error.capacity')}
          onRetry={() => capacity.refetch()}
        />
      )}
      {capacity.data && (
        <CapacityCard cap={capacity.data} liveDecodeTokS={live?.aggregateDecodeTokS} />
      )}

      {/* P-12 pattern: always render ReconcilerStatusCard after loading completes */}
      {!reconcilerStatus.isLoading && (
        <ReconcilerStatusCard status={reconcilerStatus.data} />
      )}

      <ClusterStatusCard />
      <SloStatusCard />
    </div>
  );
}
