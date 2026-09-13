# Post-mortem — the local demo stack breaks in three separate ways

Date: 2026-09-12
Area: local demo / docker / control-plane ↔ gateway contract

## Symptom reported

The Playground showed **three** models in the picker, and **every one of them**
returned:

> The Gateway did not respond. Check a model is deployed and your API key is
> valid, then try again.

The cluster's REST API said there was exactly **one** model (`tinyllama-1b`) and
it was `DEPLOYMENT_STATE_ACTIVE`. So both halves of the report were wrong in
interesting ways.

## Root cause 1 — the Gateway's route table does not survive a restart

**This is the real defect, and it is not a dev-machine quirk.**

The Gateway holds a `model_id → endpoint` route table **in memory only**. It is
populated *exclusively* by the control plane pushing
`PUT {gateway}/api/v1/routes`. There is no pull, no periodic reconcile, no
persistence (`rust/crates/gateway/src/routes/management.rs` exposes only `PUT`,
`DELETE /{model_id}` and an `index`; `go/controlplane/orchestrator/gateway.go`
is the push client).

So a Gateway restart is a **total inference outage** until someone re-deploys a
model. Live evidence from the gateway log:

```
07:18:29  route upserted by control plane   model_id=tinyllama-1b state=active
07:18:34  routing inference request to deployment host          ← worked
09:23:35  usage reporting enabled: will POST to control plane   ← RESTART
09:23:48  gateway error status=503 message="model not available"
```

`GET /v1/models` returned `{"object":"list","data":[]}` and every completion
returned `503 node_unavailable`. Service was restored by manually `PUT`-ing the
route — which proves the Gateway was healthy and only lacked state.

**In production**: restarting one Gateway pod drops all traffic on the floor.
Fix tracked as: control-plane reconcile loop that converges the Gateway's route
set to the ACTIVE deployments on startup and periodically.

## Root cause 2 — "three models" was a symptom, not a cause

`ui/src/pages/PlaygroundPage.tsx` prefers the Gateway's `GET /v1/models` and
**falls back to the active deployments' model ids** when that call fails. The
fallback **did not dedupe**. The control plane permitted three concurrent ACTIVE
deployments of the *same* `tinyllama-1b` (created 19:21, 07:14, 07:18 — no
supersede on re-deploy), so with the Gateway down the picker rendered three
identical options.

Read this the right way: the three entries were a *consequence* of cause 1, and
they were also a *diagnostic gift* — a correct-looking picker would have hidden
the fact that the Gateway list was failing. The lesson is that a silently-empty
API result plus a lenient fallback turns one fault into a confusing second
symptom.

## Root cause 3 — the demo stack was wired to a session-scoped file

The running nginx reverse proxy mounted its config from
`$CLAUDE_JOB_DIR/tmp/demo-nginx-native.conf` — a **session temporary
directory**. The whole demo topology was therefore tied to the lifetime of one
agent session, and any Docker restart took it down with no way to bring it back
from the repo.

## Gotcha worth remembering: a single-file bind mount pins the inode

Docker bind-mounting a **file** (not a directory) mounts that file's *inode*. Any
editor that saves by writing a new file and renaming it (which the Edit tool
does) leaves the container reading the **old** inode forever:

```console
$ grep -n 'proxy_pass.*ui' /home/andrea/.claude/jobs/.../demo-nginx-native.conf
27:        proxy_pass http://ui:8080;          # host: edited
$ docker exec purser-proxy grep -n 'proxy_pass.*ui' /etc/nginx/conf.d/default.conf
27:        proxy_pass http://ui:80;            # container: STILL the old content
```

`nginx -s reload` does **not** help — the container never saw the new bytes.
`docker restart` re-establishes the bind and does. **When bind-mounting a config
file, mount the containing directory instead**, or expect edits to silently not
apply.

## Two committed config defects found on the way

Both on the documented demo path, both pre-existing:

1. **`docker-compose.yml` was unparsable.** `PURSER_AGENT_GRPC_INSECURE` was
   nested inside the `ports:` sequence instead of `environment:`. A mapping item
   in a list of port strings makes `docker compose config` exit 1 with
   `did not find expected '-' indicator`, so `docker compose up` **and**
   `--profile full up` could not run at all — and the variable never reached the
   container either.
2. **The dashboard had never been served.** `deploy/docker/demo-nginx.conf`
   proxied `/` to `ui:80`, but the `purser-ui` image listens on **8080**
   (`deploy/docker/nginx.conf` `listen 8080`; `ui.Dockerfile` `EXPOSE 8080`).
   Every visit to the documented `http://localhost:3000` returned **502**. The
   docs were right and the config was wrong.

## Startup & lifecycle failures found bringing the stack back up (2026-09-13)

A cold restart after ~a day surfaced three more, none derivable from the code:

1. **Port 9443/8080 "address already in use" — a stray *native* control-plane.**
   A `bin/control-plane` launched manually (or by a native e2e run) had been
   holding `:9443` and `:8080` for **23h**, outside Docker. `docker compose up`
   fails at the CP with `failed to bind host port 0.0.0.0:9443`. Find it with
   `sudo ss -ltnp | grep -E ':9443|:8080'` and `kill` the PID (it shuts down
   gracefully; `-9` if it lingers). Native `bin/*` processes routinely outlive
   their session — check for them before blaming Docker.
2. **nginx proxy exits `(1)` with `host not found in upstream "control-plane"`.**
   nginx resolves every `proxy_pass` upstream hostname **once at boot**. If the
   proxy container starts before the control-plane's DNS name is registered on the
   compose network, it aborts immediately — so `docker compose ps -a` shows the
   other four services `Up` and `proxy` `Exited (1)`, and `:3000` refuses
   connections. Fix: `docker compose up -d proxy` again once the CP is up.
   (`depends_on` orders *start*, not *readiness*, so the race can still occur.)
   **Always use `ps -a`** when the stack looks half-up — a plain `ps` hides the
   exited proxy.
3. **`Exited (137)` is the host OOM-killer, not a fat container, and there is no
   `restart:` policy.** The five services use ~10–45 MB each, so 137 came from
   host memory pressure (a concurrent Rust/UI build, or the native+Docker CP
   contention in #1) or a manual kill — *not* a compose memory cap (none is set).
   Because no service declares `restart:`, a killed control-plane **stays dead**,
   and the gateway then 503s (routes are push-only from the CP — see top of this
   doc). Recovery is `docker compose up -d control-plane` + restart proxy (#2).
   If it recurs, add `restart: unless-stopped` to the long-lived services.

The operator runbook (start/stop/rebuild/health-check + these fixes) now lives in
the root `CLAUDE.md` under "Running the demo stack locally".

## Rules that would have prevented this

- Never point local infrastructure at `$CLAUDE_JOB_DIR/tmp`. Bring the stack up
  from the repo (`deploy/docker/demo-nginx.conf`, `docker-compose.yml`) so a
  Docker restart is recoverable.
- `docker compose config` is a one-second syntax check — run it after any edit
  to a compose file. It would have caught defect 1 immediately.
- After editing a bind-mounted config, **verify the container's view of it**
  (`docker exec … cat`), not just the host's.
- Any component holding state that another component pushes should be able to
  rebuild it. Ask "what happens if this restarts right now?" for every service.
- Check for **stray native `bin/*` processes** holding ports before bringing the
  Docker stack up; inspect stack state with `docker compose ps -a` (not `ps`) so
  crashed containers are visible.
- Compose references pre-built `*-local` image tags with **no `build:` stanza** —
  `up -d` never rebuilds. After a code change, rebuild the tagged image and
  `up -d --force-recreate <service>`, or the stack runs stale bytes.
