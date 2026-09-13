import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  StatusPill,
  type Tone,
} from '../components/ui';
import { IconArrowRight, IconLayers } from '../components/icons';
import { useDeployments, useModelHealth, useNodes, useUndeploy } from '../hooks/queries';
import { useT } from '../i18n';
import type { StringKey } from '../i18n/en';
import { useMemo } from 'react';
import { errorMessage } from '../lib/errors';
import type { Deployment, DeploymentState, ModelHealthStatus } from '../api/types';

const STATE_LABEL: Record<DeploymentState, StringKey> = {
  planned: 'deploy.state.planned',
  provisioning: 'deploy.state.provisioning',
  active: 'deploy.state.active',
  rebalancing: 'deploy.state.rebalancing',
  stopping: 'deploy.state.stopping',
  stopped: 'deploy.state.stopped',
  failed: 'deploy.state.failed',
};

const DEP_TONE: Record<DeploymentState, Tone> = {
  planned: 'info',
  provisioning: 'info',
  active: 'success',
  rebalancing: 'warning',
  stopping: 'warning',
  stopped: 'neutral',
  failed: 'danger',
};

const HEALTH_TONE: Record<ModelHealthStatus, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  unavailable: 'danger',
};

const HEALTH_I18N_KEY: Record<ModelHealthStatus, StringKey> = {
  healthy: 'deployments.health.healthy',
  degraded: 'deployments.health.degraded',
  // W1: renamed from "Unavailable" — that word implies network unreachability,
  // but "unavailable" health status just means no deployment is serving the model.
  unavailable: 'deployments.health.unavailable',
};

/** States where the deployment is not serving traffic and is at rest. */
const INACTIVE_STATES = new Set<DeploymentState>(['stopped', 'failed']);

/** Fetches and renders a health badge for a single model. Uses its own hook
 *  so each card can call useModelHealth without violating the rules of hooks. */
export function DeploymentHealthBadge({ modelId }: { modelId: string }) {
  const t = useT();
  const { data, isLoading } = useModelHealth(modelId);

  if (isLoading || !data) {
    return <Badge tone="neutral">—</Badge>;
  }

  return <Badge tone={HEALTH_TONE[data.status]}>{t(HEALTH_I18N_KEY[data.status])}</Badge>;
}

function DeploymentCard({
  dep,
  names,
}: {
  dep: Deployment;
  names: Record<string, string>;
}) {
  const t = useT();
  const undeploy = useUndeploy();
  const heading = (state: DeploymentState): string =>
    t(STATE_LABEL[state] ?? 'deploy.state.provisioning');

  // W1: stopped/failed deployments are "inactive" — they are at rest and not
  // serving traffic. The distinction drives: button label, hint visibility,
  // and undeploy button visibility (option A: hide for stopped/failed, as
  // DELETE on an already-stopped deployment is a no-op that confuses users).
  const inactive = INACTIVE_STATES.has(dep.state);

  const onUndeploy = () => {
    if (window.confirm(t('deployments.undeployConfirm', { model: dep.plan.modelId }))) {
      undeploy.mutate(dep.id);
    }
  };

  return (
    <Card className="dep-card">
      <div className="dep-card__head">
        <div>
          <h3 className="model-card__name">{dep.plan.modelId}</h3>
          <p className="model-card__id">
            {dep.plan.quantization} · {dep.plan.assignments.length}{' '}
            {t('fleet.capacity.nodes').toLowerCase()}
          </p>
          <p className="model-card__meta muted">
            <span data-testid="dep-created-at">
              {dep.createdAt ? dep.createdAt.slice(0, 10) : '—'}
            </span>
          </p>
        </div>
        <div className="dep-card__badges">
          <Badge tone={DEP_TONE[dep.state]}>{heading(dep.state)}</Badge>
          <DeploymentHealthBadge modelId={dep.plan.modelId} />
        </div>
      </div>
      {dep.error && (
        <p className="dep-card__error text--danger" data-testid="dep-error">
          Error: {dep.error}
        </p>
      )}
      {inactive && (
        <p className="dep-card__hint muted" data-testid="dep-inactive-hint">
          {t('deployments.hint.inactive')}
        </p>
      )}
      <ul className="dep-card__nodes">
        {dep.nodeStatus.map((s) => (
          <li key={s.nodeId}>
            <div className="rollout__head">
              <span className="muted">{names[s.nodeId] ?? s.nodeId}</span>
              <StatusPill state={s.state} />
            </div>
            {s.state !== 'running' && <ProgressBar value={s.progress} />}
          </li>
        ))}
      </ul>
      <div className="model-card__actions">
        {/* W1: button label now communicates the action at the destination.
            Stopped/failed → "Configure and start"; live → "Reconfigure". */}
        <Link to={`/deploy/${dep.plan.modelId}`} className="btn btn--secondary btn--sm link-btn">
          <span>
            {t(inactive ? 'deployments.action.configure' : 'deployments.action.reconfigure')}
          </span>
          <IconArrowRight />
        </Link>
        {/* W1 option A: undeploy only makes sense on live deployments. On an
            already-stopped deployment DELETE is effectively a no-op (it would
            leave the record in stopped state unchanged), so hide it. */}
        {!inactive && (
          <Button variant="danger" size="sm" disabled={undeploy.isPending} onClick={onUndeploy}>
            {t('deployments.undeploy')}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function DeploymentsPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useDeployments();
  const nodes = useNodes();
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    (nodes.data ?? []).forEach((n) => (m[n.profile.nodeId] = n.profile.hostname));
    return m;
  }, [nodes.data]);

  // W1: split deployments into two groups for clarity.
  // "Active" covers anything that is live or transitioning (planned/provisioning/
  // active/rebalancing/stopping). "Inactive" covers terminal at-rest states.
  const activeDeployments = useMemo(
    () => (data ?? []).filter((d) => !INACTIVE_STATES.has(d.state)),
    [data],
  );
  const inactiveDeployments = useMemo(
    () => (data ?? []).filter((d) => INACTIVE_STATES.has(d.state)),
    [data],
  );

  return (
    <div className="page">
      <PageHeader
        title={t('nav.deployments')}
        subtitle="Active and provisioning model deployments across your fleet."
      />
      {isLoading && <LoadingBlock />}
      {isError && (
        <ErrorState message={errorMessage(error, t, 'error.deployments')} onRetry={() => refetch()} />
      )}
      {data && data.length === 0 && (
        <EmptyState
          icon={<IconLayers />}
          message={t('deployments.empty')}
          action={
            <Link to="/catalog" className="btn btn--primary btn--md link-btn">
              <span>{t('nav.catalog')}</span>
              <IconArrowRight />
            </Link>
          }
        />
      )}
      {data && data.length > 0 && (
        <div className="dep-sections">
          {/* Section 1: live / transitional deployments */}
          <section className="dep-section" aria-labelledby="dep-section-active">
            <h2 id="dep-section-active" className="dep-section__heading">
              {t('deployments.section.active')}
            </h2>
            {activeDeployments.length === 0 ? (
              <p className="dep-section__empty muted">{t('deployments.section.emptyActive')}</p>
            ) : (
              <div className="grid grid--cards">
                {activeDeployments.map((dep) => (
                  <DeploymentCard key={dep.id} dep={dep} names={names} />
                ))}
              </div>
            )}
          </section>

          {/* Section 2: stopped / failed deployments */}
          {inactiveDeployments.length > 0 && (
            <section className="dep-section" aria-labelledby="dep-section-inactive">
              <h2 id="dep-section-inactive" className="dep-section__heading">
                {t('deployments.section.inactive')}
              </h2>
              <div className="grid grid--cards">
                {inactiveDeployments.map((dep) => (
                  <DeploymentCard key={dep.id} dep={dep} names={names} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
