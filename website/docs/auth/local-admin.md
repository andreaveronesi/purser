# Local admin login (master key)

Purser can enforce real authentication without an external identity provider. When you
set a **master key** on the control plane, Purser exposes a built-in local admin account:
a single username/password pair that logs into the operator UI and management REST API
over a server-side session cookie.

This is the right option when you want the demo/fail-open behaviour switched off — so the
dashboard is no longer wide open — but you are not ready to wire up OIDC or LDAP. It works
for a home lab, a locked-down single-operator deployment, or any environment where a full
IdP is more machinery than you need.

## Enable it

Set `PURSER_ADMIN_PASSWORD` on the control-plane container. That value **is** the master
key — its presence enables the local admin account, and the password logs you in.

```bash
# Control-plane environment
PURSER_ADMIN_PASSWORD=change-me-to-a-long-random-secret
PURSER_ADMIN_USERNAME=admin           # optional, default: "admin"
PURSER_SESSION_SECRET=$(openssl rand -hex 32)   # strongly recommended, see below
```

The username may instead be set declaratively in `purser.yaml`:

```yaml
localAuth:
  username: admin        # optional; default "admin"
```

!!! warning "The password is read from the environment only"
    `PURSER_ADMIN_PASSWORD` is read **only** from the environment — never from
    `purser.yaml`. A `password` key under `localAuth` in the YAML is **ignored**, so
    a secret can never be committed to a config file by accident. Keep the master key
    in your secret store (Kubernetes `Secret`, Vault, systemd `EnvironmentFile`, etc.)
    and inject it as an environment variable.

Once the control plane is running with the master key set, log in with:

```bash
curl -i -X POST http://localhost:3000/auth/local-login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-to-a-long-random-secret"}'
```

On success the server sets an **HttpOnly** session cookie (`SameSite=Strict`, 8-hour
TTL). The session is stored server-side with `auth_method=local` and `role=admin`, and is
sent automatically with all subsequent same-origin API calls.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PURSER_ADMIN_PASSWORD` | (empty) | The master key. Setting it enables the local admin account and disables demo/fail-open mode. Read from the environment only. |
| `PURSER_ADMIN_USERNAME` | `admin` | Username for the local admin account. May also be set as `localAuth.username` in `purser.yaml`. |
| `PURSER_SESSION_SECRET` | (auto) | 64-character hex (32-byte) HMAC key for signing session cookies. Set it so sessions survive a control-plane restart. |

## Security

!!! warning "Enabling the master key disables demo / fail-open mode"
    With **no** master key set (and no OIDC and no API keys), the control plane runs in
    **demo mode**: anonymous `/api/v1/*` requests fall through as an implicit admin, and
    the UI grants full access with no login. The moment `PURSER_ADMIN_PASSWORD` is set,
    that fail-open path closes: anonymous `/api/v1/*` requests return **401** and the UI
    shows a login screen. Setting the master key is therefore how you turn a demo stack
    into an access-controlled one without standing up an IdP.

!!! tip "Set `PURSER_SESSION_SECRET` so logins survive a restart"
    Sessions are signed with `PURSER_SESSION_SECRET`. If you do not set it, the control
    plane generates an **ephemeral** key at startup, so every operator is logged out the
    next time the control plane restarts. Set a persistent 32-byte key
    (`openssl rand -hex 32`) in any real deployment — especially rolling / multi-replica
    ones. See [Authentication — Getting Started](getting-started.md) for the shared
    session-cookie model.

**Rotating the master key** is deliberately simple: change `PURSER_ADMIN_PASSWORD` and
restart the control plane. There is no separate rotation endpoint. Note that Purser does
**not** enforce any password length or strength — the master key's quality is entirely
the operator's responsibility, so choose a long, random value.

## In the UI

The login form for the local admin account only appears when the UI knows the feature is
enabled. The UI reads `window.__PURSER_CONFIG__.localAuth` at runtime; when that flag is
set, the `/login` page renders a username/password form that posts to
`POST /auth/local-login`.

!!! note "The UI flag is set on the UI container, not the control plane"
    Operators enable the login form through the **UI container's runtime config** (the
    same mechanism that injects `window.__PURSER_CONFIG__`), not through a rebuild. This
    is described in the deployment notes alongside the control-plane environment above —
    set `PURSER_ADMIN_PASSWORD` on the control plane **and** the local-auth runtime flag
    on the UI container so the server enforcement and the login form agree.

## Limitations

The local admin account is intentionally minimal. For anything richer, use OIDC or LDAP
(see [Authentication — Getting Started](getting-started.md)).

- **Single admin account.** There is exactly one local user; there is no support for
  multiple local users, groups, or per-user roles. The account is always `role=admin`.
- **No self-service password reset.** Rotation is an operator action: change the
  environment variable and restart the control plane.
- **No dedicated brute-force lockout.** There is no account-lockout after failed logins.
  The existing request rate-limit middleware still applies to `/auth/local-login`, but it
  is not a per-account lockout.
