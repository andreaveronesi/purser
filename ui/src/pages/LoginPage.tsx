// ---------------------------------------------------------------------------
// LoginPage — /login
//
// Shown when the session is unauthenticated and auth is configured. Three modes:
//
//   OIDC configured   → "Sign in with OIDC" button that starts the server-side
//                        PKCE flow (GET /auth/login).
//   LDAP always shown → username/password form → POST /auth/ldap-login.
//                        On success the server sets a session cookie and we
//                        redirect to /. On failure we show an inline error.
//   Local admin       → When config.localAuth is set (and OIDC is not), the
//                        control plane has a built-in local admin account; we
//                        show a username/password form → POST /auth/local-login.
//   Dev-mode          → No auth is configured (neither OIDC nor local admin);
//                        we show an informational banner and a "Continue" link
//                        to /. The demo is never blocked.
// ---------------------------------------------------------------------------
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { config } from '../api/config';
import { api } from '../api/client';

export function LoginPage() {
  const t = useT();
  const oidcConfigured = Boolean(config.oidc);
  const localAuthConfigured = Boolean(config.localAuth);
  // Dev-mode: no auth provider configured at all (neither OIDC nor local admin).
  const devMode = !oidcConfigured && !localAuthConfigured;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ldapError, setLdapError] = useState<string | null>(null);
  const [ldapLoading, setLdapLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localLoading, setLocalLoading] = useState(false);

  // ── Dev-mode branch ─────────────────────────────────────────────────────
  if (devMode) {
    return (
      <div className="login-page login-page--dev">
        <div className="login-card">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">P</span>
            <div className="brand__text">
              <span className="brand__name">{t('app.name')}</span>
              <span className="brand__tag">{t('app.tagline')}</span>
            </div>
          </div>
          <div className="login-dev-banner">
            <h1 className="login-dev-banner__title">{t('auth.devMode.title')}</h1>
            <p className="login-dev-banner__body">{t('auth.devMode.body')}</p>
            <Link to="/" className="btn btn--primary" role="link">
              {t('auth.devMode.continue')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Auth-configured branch ───────────────────────────────────────────────

  async function handleLdapSubmit(e: FormEvent) {
    e.preventDefault();
    setLdapError(null);
    setLdapLoading(true);
    try {
      await api.ldapLogin(username, password);
      // Session cookie is now set — navigate to the dashboard.
      window.location.href = '/';
    } catch {
      setLdapError(t('auth.login.ldap.error'));
    } finally {
      setLdapLoading(false);
    }
  }

  async function handleLocalSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setLocalLoading(true);
    try {
      await api.localLogin(username, password);
      // Session cookie is now set — navigate to the dashboard.
      window.location.href = '/';
    } catch {
      setLocalError(t('auth.login.local.error'));
    } finally {
      setLocalLoading(false);
    }
  }

  // ── Local-admin branch ────────────────────────────────────────────────────
  // The control plane has a built-in local admin account (and OIDC is not
  // configured): show a username/password form posting to /auth/local-login.
  if (localAuthConfigured && !oidcConfigured) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">P</span>
            <div className="brand__text">
              <span className="brand__name">{t('app.name')}</span>
              <span className="brand__tag">{t('app.tagline')}</span>
            </div>
          </div>

          <h1 className="login-card__title">{t('auth.login.title')}</h1>

          <form className="login-section login-section--local" onSubmit={handleLocalSubmit} noValidate>
            <h2 className="login-section__title">{t('auth.login.local.title')}</h2>

            <div className="form-field">
              <label className="form-field__label" htmlFor="local-username">
                {t('auth.login.local.username')}
              </label>
              <input
                id="local-username"
                className="input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor="local-password">
                {t('auth.login.local.password')}
              </label>
              <input
                id="local-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {localError && (
              <p className="login-error" role="alert">
                {localError}
              </p>
            )}

            <button
              className="btn btn--primary btn--full-width"
              type="submit"
              disabled={localLoading}
            >
              {t('auth.login.local.submit')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">P</span>
          <div className="brand__text">
            <span className="brand__name">{t('app.name')}</span>
            <span className="brand__tag">{t('app.tagline')}</span>
          </div>
        </div>

        <h1 className="login-card__title">{t('auth.login.title')}</h1>

        {/* OIDC sign-in */}
        {oidcConfigured && (
          <div className="login-section login-section--oidc">
            <button
              className="btn btn--primary btn--full-width"
              onClick={() => { window.location.href = '/auth/login'; }}
              type="button"
            >
              {t('auth.login.oidc.button')}
            </button>
            <div className="login-divider" aria-hidden="true">
              <span>or</span>
            </div>
          </div>
        )}

        {/* LDAP form — always shown in auth-configured mode */}
        <form className="login-section login-section--ldap" onSubmit={handleLdapSubmit} noValidate>
          <h2 className="login-section__title">{t('auth.login.ldap.title')}</h2>

          <div className="form-field">
            <label className="form-field__label" htmlFor="ldap-username">
              {t('auth.login.ldap.username')}
            </label>
            <input
              id="ldap-username"
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label className="form-field__label" htmlFor="ldap-password">
              {t('auth.login.ldap.password')}
            </label>
            <input
              id="ldap-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {ldapError && (
            <p className="login-error" role="alert">
              {ldapError}
            </p>
          )}

          <button
            className="btn btn--primary btn--full-width"
            type="submit"
            disabled={ldapLoading}
          >
            {t('auth.login.ldap.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
