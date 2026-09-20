# Purser on k3s — local example

Bring up the **whole Purser platform** (control-plane + gateway + operator UI) on
a local [k3s](https://k3s.io) cluster, CPU-only, with the **built-in local admin
login enabled** so you sign in for real — not in demo/fail-open mode.

This is an *example deployment*, not a second copy of the chart. It reuses the
Helm chart at [`deploy/helm/purser`](../../deploy/helm/purser) and only supplies
a values overlay ([`values-k3s.yaml`](./values-k3s.yaml)). You install and
uninstall it **by hand** with the commands below.

```
example/k3s/
├── values-k3s.yaml   # Helm values overlay for the chart (mock engine, sqlite,
│                     # ingress on, local admin login, local images)
└── README.md         # you are here
```

## What you get

| Component | In-cluster | Reached via ingress |
|---|---|---|
| Operator UI (nginx) | Service `:8080` | `http://purser.localtest.me/` |
| Control-plane REST | Service `:8080` | `…/api/v1` |
| Gateway (OpenAI-compatible) | Service `:8080` | `…/v1` |

- **CPU-only:** the control-plane runs with the **mock engine** — no GPU, no
  external Agent needed. The platform, UI, and login work end-to-end. (Real
  inference needs an Agent, which runs *outside* Kubernetes; this example does
  not deploy one.)
- **Single node:** SQLite on a small PVC (k3s `local-path` StorageClass), one
  control-plane replica.
- **Single origin:** the built-in k3s **Traefik** ingress routes `/api`,`/v1`,`/`
  from one hostname, so the UI's same-origin defaults work with no CORS.
- **Real login:** `PURSER_ADMIN_PASSWORD` is set on the control-plane (enables
  `POST /auth/local-login` **and** closes the anonymous `/api/v1/*` fail-open),
  and `PURSER_UI_LOCAL_AUTH=1` makes the UI show the login form.

## Prerequisites

- **k3s** installed and running (you manage it yourself — this example does not
  install or tear down k3s). Quick install:
  ```bash
  curl -sfL https://get.k3s.io | sh -
  # kubectl/helm need the kubeconfig; either run them with sudo, or:
  mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config \
    && sudo chown "$(id -u):$(id -g)" ~/.kube/config
  ```
- **helm** and **kubectl** on your PATH (Purser ships helm in `.toolchain/`;
  `source ./env.sh` from the repo root).
- **Docker** to build the images (rootful here → `sudo docker …`).

> **Why local images?** The v0.7 images that contain the local-admin login are
> **not published to GHCR yet** (latest release is 0.6). So this example builds
> the images from source and imports them into k3s. Once v0.7 is released you can
> switch to GHCR images instead — see [Variant: GHCR images](#variant-use-ghcr-images).

## Bring it up (by hand)

All commands are run from **this directory** (`example/k3s/`) unless noted.

### 1. Build the three images (context = repo root)

```bash
cd ../..                                    # repo root
sudo docker build -f deploy/docker/control-plane.Dockerfile -t purser-control-plane:v0.7-local .
sudo docker build -f deploy/docker/gateway.Dockerfile       -t purser-gateway:v0.7-local .
sudo docker build -f deploy/docker/ui.Dockerfile            -t purser-ui:v0.7-local .
cd example/k3s
```

### 2. Import the images into k3s containerd

k3s uses containerd, not the Docker daemon, so a `docker build` alone is not
visible to k3s. Import each image:

```bash
for img in purser-control-plane purser-gateway purser-ui; do
  sudo docker save "$img:v0.7-local" | sudo k3s ctr images import -
done
# verify:
sudo k3s ctr images ls | grep purser
```

The overlay sets `image.pullPolicy: Never`, so k3s uses exactly these imported
images and never tries to pull from a registry.

### 3. Set a real admin password (recommended)

`values-k3s.yaml` ships a throwaway password and an all-zero session secret.
Override them at install time so the master key is yours:

```bash
ADMIN_PW='choose-a-long-random-password'
SESSION_SECRET="$(openssl rand -hex 32)"     # exactly 64 hex chars
```

### 4. Install the chart with this overlay

```bash
helm install purser ../../deploy/helm/purser \
  -n purser --create-namespace \
  -f values-k3s.yaml \
  --set-string controlPlane.extraEnv[0].name=PURSER_ADMIN_USERNAME \
  --set-string controlPlane.extraEnv[0].value=admin \
  --set-string controlPlane.extraEnv[1].name=PURSER_ADMIN_PASSWORD \
  --set-string controlPlane.extraEnv[1].value="$ADMIN_PW" \
  --set-string controlPlane.extraEnv[2].name=PURSER_SESSION_SECRET \
  --set-string controlPlane.extraEnv[2].value="$SESSION_SECRET"
```

> Prefer not to pass secrets on the CLI? Just edit `values-k3s.yaml` and run the
> plain `helm install purser ../../deploy/helm/purser -n purser --create-namespace -f values-k3s.yaml`.

### 5. Wait for rollout

```bash
kubectl -n purser rollout status deploy/purser-control-plane
kubectl -n purser rollout status deploy/purser-gateway
kubectl -n purser rollout status deploy/purser-ui
kubectl -n purser get pods,svc,ingress
```

### 6. Open the UI and log in

`purser.localtest.me` (and any `*.localtest.me`) resolves to `127.0.0.1` with no
`/etc/hosts` edit, so once Traefik has the ingress:

- Open **http://purser.localtest.me/**
- You get the **login form** (not the demo banner). Sign in with
  **`admin`** / the password you set in step 3.

Sanity-check from the shell:

```bash
# health (unauthenticated, always allowed):
curl -s -o /dev/null -w '%{http_code}\n' http://purser.localtest.me/api/v1/cluster/health   # 200

# anonymous management call is now REFUSED (fail-open closed):
curl -s -o /dev/null -w '%{http_code}\n' http://purser.localtest.me/api/v1/nodes            # 401

# log in → capture the session cookie → call again:
curl -s -c cookies.txt -X POST http://purser.localtest.me/auth/local-login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PW\"}" -o /dev/null -w 'login: %{http_code}\n'   # 302
curl -s -b cookies.txt -o /dev/null -w '%{http_code}\n' http://purser.localtest.me/api/v1/nodes     # 200
```

## Tear it down (by hand)

```bash
helm uninstall purser -n purser
kubectl delete namespace purser        # also removes the PVC (SQLite data)
```

k3s itself is left running — you installed it, you remove it (`/usr/local/bin/k3s-uninstall.sh`).

## Variant: use GHCR images

Once the v0.7 images are published to GHCR you can skip steps 1–2 and pull
instead. Override the overlay:

```bash
helm install purser ../../deploy/helm/purser -n purser --create-namespace \
  -f values-k3s.yaml \
  --set image.pullPolicy=IfNotPresent \
  --set image.controlPlane.repository=ghcr.io/andrew19881123/purser-control-plane \
  --set image.controlPlane.tag=0.7.0 \
  --set image.gateway.repository=ghcr.io/andrew19881123/purser-gateway \
  --set image.gateway.tag=0.7.0 \
  --set image.ui.repository=ghcr.io/andrew19881123/purser-ui \
  --set image.ui.tag=0.7.0
```

## Troubleshooting

- **UI pod not ready / 404 through ingress** — confirm the UI Service targets
  port **8080** (`kubectl -n purser get svc purser-ui -o wide`). The nginx image
  listens on 8080 and runs non-root; this overlay sets `ui.port: 8080`.
- **`ErrImageNeverPull`** — the image wasn't imported into k3s containerd. Re-run
  step 2 and check `sudo k3s ctr images ls | grep purser`.
- **Login form doesn't appear (demo banner instead)** — the UI needs
  `PURSER_UI_LOCAL_AUTH=1` (set by this overlay). Check
  `kubectl -n purser exec deploy/purser-ui -- cat /usr/share/nginx/html/env.js`
  shows `localAuth: true`.
- **Logged out after a restart** — set a persistent `PURSER_SESSION_SECRET`
  (step 3); an unset/rotated secret invalidates existing session cookies.
- **`purser.localtest.me` doesn't resolve** — some networks block public
  wildcard-DNS resolvers. Add `127.0.0.1 purser.localtest.me` to `/etc/hosts`, or
  set `ingress.host` to a name you control.

## See also

- [`website/docs/auth/local-admin.md`](../../website/docs/auth/local-admin.md) — the local admin login feature.
- [`deploy/helm/purser/README.md`](../../deploy/helm/purser/README.md) — the full chart and all its values.
- [`deploy/README.md`](../../deploy/README.md) — deployment guide (images, networking, secrets).
