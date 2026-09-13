# Authentication — Getting Started

Purser's operator UI supports three authentication modes: OIDC (recommended for
production), LDAP, and development mode (no auth required, used for demos and local
development).

## OIDC login

When `PURSER_OIDC_ISSUER`, `PURSER_OIDC_CLIENT_ID`, and `PURSER_OIDC_REDIRECT_URI`
are all set on the control-plane container, the UI shows a **Sign in with OIDC** button
on the `/login` page.

Clicking it redirects the browser to `GET /auth/login` on the control plane. The server
generates a PKCE state/verifier pair, redirects to the IdP, handles the callback, sets a
`session` cookie, and redirects back to `/`. The PKCE code verifier never touches the
browser — it is managed entirely server-side.

After a successful OIDC login the session cookie is used for all subsequent API calls
(same-origin, `credentials: 'same-origin'`). The session carries the user's role and
organisation memberships.

### OIDC environment variables

| Variable                   | Description                                    |
|----------------------------|------------------------------------------------|
| `PURSER_OIDC_ISSUER`       | OIDC issuer URL (e.g. `https://accounts.google.com`) |
| `PURSER_OIDC_CLIENT_ID`    | OAuth 2.0 client ID registered with the IdP   |
| `PURSER_OIDC_REDIRECT_URI` | Callback URL (e.g. `https://purser.example.com/auth/callback`) |

## LDAP login

The LDAP form is always shown alongside the OIDC button when auth is configured. A
username/password pair is submitted to `POST /auth/ldap-login`. On success the server
sets the same session cookie and the browser is redirected to `/`.

If LDAP is not configured on the server the request returns an error and an inline
message is displayed.

## Development mode

When neither OIDC nor LDAP authentication is configured, the control plane treats every
request as fully authenticated. The UI detects this state (`config.oidc === null`) and
enters **development mode**:

- The `/login` page shows a banner explaining that auth is not configured.
- A **Continue** link takes the user directly to the dashboard.
- A "Dev mode" badge appears in the topbar.
- All routes are accessible with no redirect.

Development mode is the default when running `docker compose up -d` (the demo stack)
without setting any `PURSER_OIDC_*` variables.

## What /me returns

After a successful login, `GET /api/v1/platform/users/me` returns the current user:

```json
{
  "actor": "alice@example.com",
  "email": "alice@example.com",
  "role": "platform_admin",
  "is_platform_admin": true,
  "is_org_admin": false,
  "orgs": [...],
  "teams": [...]
}
```

The UI camelizes the wire names (`is_platform_admin` → `isPlatformAdmin`) before
exposing them via the `useAuth()` hook:

```tsx
import { useAuth } from '../lib/auth';

function MyComponent() {
  const { user, isAuthenticated, isDevMode } = useAuth();
  // user.email, user.isPlatformAdmin, etc.
}
```

## Logout

A **Sign out** button appears in the topbar when a user is authenticated. It navigates to
`GET /auth/logout` which clears the session cookie server-side and redirects back to
`/login`.
