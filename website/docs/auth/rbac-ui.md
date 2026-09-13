# UI navigation and action gating (RBAC)

Purser's operator dashboard filters the navigation sidebar and hides
destructive action buttons based on the authenticated user's role. This
is a **UX layer only** — the control-plane API enforces authorisation
independently. The front-end gating prevents users from seeing actions
that would yield a 403 response.

## Navigation section visibility

| Section | Visible to |
|---|---|
| **Inference** (Dashboard · Fleet · Catalog · Deployments · Playground) | All authenticated users |
| **Platform** (Data Planes · Node Pools · What-if Planner) | `platform_admin`, `org_admin` |
| **Governance** (Orgs · Users · Roles · API Keys · Service Accounts · Policies · Approvals) | `platform_admin`, `org_admin` |
| **Observability** (Audit · Admin Audit · Compliance · Chargeback · SLO) | `platform_admin`, `org_admin` |
| **Administration** (Add Node · Config as Code · Settings) | `platform_admin` only |

## Dev-mode (no auth configured)

When neither OIDC nor LDAP is configured on the control plane, the UI
enters **development mode**: `isDevMode = true`. In dev-mode:

- All five navigation sections are visible to every visitor.
- A persistent **banner** is displayed at the top of every page:
  > *Development mode: authentication disabled — all users have admin access.*
- All action buttons are visible and enabled regardless of role.

This behaviour makes local development and demo stacks work without any
identity-provider setup. To exit dev-mode, configure
`PURSER_OIDC_ISSUER` (see [Authentication — Getting Started](getting-started.md)).

## Action button gating

In addition to section gating, mutating action buttons are hidden for
users who lack the required role.

| Buttons | Required permission |
|---|---|
| Create / Delete organization | `platform_admin` |
| Generate join token / Rotate token | `platform_admin` |
| Apply cluster configuration (Config as Code) | `platform_admin` |
| Create node pool | `platform_admin` or `org_admin` |
| Create role | `platform_admin` or `org_admin` |
| Create API key | `platform_admin` or `org_admin` |
| Invite platform user | `platform_admin` or `org_admin` |

### Helpers in `lib/auth.tsx`

Two React hooks expose the permission predicates:

```ts
// true if platform_admin or dev-mode
useCanAdmin(): boolean

// true if platform_admin, org_admin, or dev-mode
useCanOrgAdmin(): boolean
```

Use these in page components to conditionally render buttons:

```tsx
import { useCanAdmin } from '../lib/auth';

function MyAdminPage() {
  const canAdmin = useCanAdmin();
  return (
    <>
      {/* always visible */}
      <DataTable />

      {/* only platform_admin sees this */}
      {canAdmin && (
        <Button onClick={handleDelete}>Delete</Button>
      )}
    </>
  );
}
```

## Note on security

These checks are client-side and can be bypassed by a determined user.
The control-plane REST API enforces the same permission model on every
request — a 403 response is the authoritative enforcement boundary.
The front-end gating is purely UX: it avoids surfacing actions that
would immediately fail.
