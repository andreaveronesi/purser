// ---------------------------------------------------------------------------
// Unit tests for config.ts — runtime config resolution, mock flag,
// URL base precedence, and handleUnauthorized OIDC redirect logic.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach } from 'vitest';

// Type import for the module shape — used to annotate dynamic imports below.
import type * as ConfigModule from '../config';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Clean up any runtime config written by tests.
  if (typeof window !== 'undefined') {
    delete window.__PURSER_CONFIG__;
  }
});

// ---------------------------------------------------------------------------
// trimTrailingSlash — tested via resolveBase behavior
// ---------------------------------------------------------------------------

describe('resolveBase — trailing slash is stripped', () => {
  it('strips a trailing slash from the runtime apiBase', async () => {
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: { apiBase: 'https://cp.example.com/api/v1/' },
    });
    // Re-import the module to pick up the new window state.
    // @ts-expect-error — Vite supports query-param cache-busting but tsc module resolver does not
    const { config } = await import('../config?t=trailing-slash') as typeof ConfigModule;
    expect(config.apiBase).toBe('https://cp.example.com/api/v1');
  });
});

// ---------------------------------------------------------------------------
// resolveMock — OFF by default
// ---------------------------------------------------------------------------

describe('resolveMock — mock flag', () => {
  it('mock is false when neither runtime nor build flag is set', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=mock-default') as typeof ConfigModule;
    expect(config.mock).toBe(false);
  });

  it('mock is true when runtime config sets it explicitly', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: { mock: true } });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=mock-runtime-true') as typeof ConfigModule;
    expect(config.mock).toBe(true);
  });

  it('mock is false when runtime config explicitly sets false', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: { mock: false } });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=mock-runtime-false') as typeof ConfigModule;
    expect(config.mock).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// config.localAuth — reflects window.__PURSER_CONFIG__.localAuth === true
// ---------------------------------------------------------------------------

describe('config.localAuth — built-in local admin login flag', () => {
  it('localAuth is false when the runtime flag is absent', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=localauth-absent') as typeof ConfigModule;
    expect(config.localAuth).toBe(false);
  });

  it('localAuth is true when the runtime flag is exactly true', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: { localAuth: true } });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=localauth-true') as typeof ConfigModule;
    expect(config.localAuth).toBe(true);
  });

  it('localAuth is false when the runtime flag is explicitly false', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: { localAuth: false } });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=localauth-false') as typeof ConfigModule;
    expect(config.localAuth).toBe(false);
  });

  it('localAuth is false for a non-boolean truthy value (strict === true)', async () => {
    // Only the literal boolean true enables local auth — a stray string must not.
    vi.stubGlobal('window', { __PURSER_CONFIG__: { localAuth: 'true' as unknown as boolean } });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=localauth-string') as typeof ConfigModule;
    expect(config.localAuth).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleUnauthorized — redirect only when OIDC is configured
// ---------------------------------------------------------------------------

describe('handleUnauthorized', () => {
  it('redirects to /auth/login when OIDC is configured', async () => {
    const locationStub = { href: '' };
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: {
          issuer: 'https://idp.example.com',
          clientId: 'purser-ui',
          redirectUri: 'https://purser.example.com/callback',
        },
      },
      location: locationStub,
    });
    // @ts-expect-error — Vite cache-busting query param
    const { handleUnauthorized, config } = await import('../config?t=oidc-redirect') as typeof ConfigModule;
    // Verify OIDC was parsed from the runtime config.
    expect(config.oidc).not.toBeNull();
    handleUnauthorized();
    expect(locationStub.href).toBe('/auth/login');
  });

  it('is a no-op when OIDC is not configured', async () => {
    const locationStub = { href: 'initial' };
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {},
      location: locationStub,
    });
    // @ts-expect-error — Vite cache-busting query param
    const { handleUnauthorized } = await import('../config?t=no-oidc') as typeof ConfigModule;
    handleUnauthorized();
    expect(locationStub.href).toBe('initial');
  });

  it('is a no-op in SSR (window undefined)', async () => {
    // Simulate SSR: window is undefined.
    vi.stubGlobal('window', undefined);
    // Should not throw even if config.oidc check passes.
    // @ts-expect-error — Vite cache-busting query param
    const { handleUnauthorized } = await import('../config?t=ssr') as typeof ConfigModule;
    expect(() => handleUnauthorized()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// OIDC config — requires all three fields to be non-null
// ---------------------------------------------------------------------------

describe('config.oidc — partial OIDC config is treated as null', () => {
  it('oidc is null when only issuer is set', async () => {
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: { issuer: 'https://idp.example.com' },
      },
    });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=oidc-partial') as typeof ConfigModule;
    expect(config.oidc).toBeNull();
  });

  it('oidc is null when oidc object is empty — rt.oidc truthy but issuer absent (L113 2nd &&)', async () => {
    // rt.oidc is {} (truthy object) but rt.oidc.issuer is undefined (falsy)
    // This exercises the 2nd short-circuit point in the && chain.
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: { oidc: {} },
    });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=oidc-no-issuer') as typeof ConfigModule;
    expect(config.oidc).toBeNull();
  });

  it('oidc is null when issuer + clientId present but redirectUri absent (L113 4th &&)', async () => {
    // rt.oidc.clientId is truthy but rt.oidc.redirectUri is undefined (falsy)
    // This exercises the 4th short-circuit point in the && chain.
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: { issuer: 'https://idp.example.com', clientId: 'purser-ui' },
      },
    });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=oidc-no-redirect') as typeof ConfigModule;
    expect(config.oidc).toBeNull();
  });

  it('oidc is non-null when all three fields are present', async () => {
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: {
          issuer: 'https://idp.example.com',
          clientId: 'purser-ui',
          redirectUri: 'https://purser.example.com/callback',
        },
      },
    });
    // @ts-expect-error — Vite cache-busting query param
    const { config } = await import('../config?t=oidc-full') as typeof ConfigModule;
    expect(config.oidc).not.toBeNull();
    expect(config.oidc?.issuer).toBe('https://idp.example.com');
    expect(config.oidc?.clientId).toBe('purser-ui');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage — resolveBase env path + isTruthyFlag truthy values
// These tests use vi.resetModules() + standard import (not ?t= trick) so that
// V8 instruments the module re-evaluation properly.
// ---------------------------------------------------------------------------

describe('resolveBase — Vite env variable path (L72-73)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses VITE_PURSER_API_BASE env variable when runtime override is absent (L73)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_API_BASE', 'https://env.example.com/api/v1');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('https://env.example.com/api/v1');
  });

  it('strips trailing slash from Vite env variable', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_GATEWAY_BASE', 'https://gw.example.com/v1/');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.gatewayBase).toBe('https://gw.example.com/v1');
  });
});

describe('isTruthyFlag — truthy string values exercise all OR branches', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mock is true when VITE_PURSER_MOCK=1 (isTruthyFlag "1" branch)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} }); // no runtime boolean mock
    vi.stubEnv('VITE_PURSER_MOCK', '1');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });

  it('mock is true when VITE_PURSER_MOCK=true (isTruthyFlag "true" branch)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', 'true');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });

  it('mock is true when VITE_PURSER_MOCK=on (isTruthyFlag "on" branch)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', 'on');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });

  it('mock is true when VITE_PURSER_MOCK=yes (isTruthyFlag "yes" branch)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', 'yes');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });

  it('mock is false when VITE_PURSER_MOCK=0 (isTruthyFlag falsy)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', '0');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(false);
  });
});

describe('runtime() — window.__PURSER_CONFIG__ absent (L63 ?? branch)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns {} when window.__PURSER_CONFIG__ is undefined (L63 ?? fallback)', async () => {
    // window exists but __PURSER_CONFIG__ is not defined — exercises the `?? {}` branch
    vi.stubGlobal('window', {});
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    // When no config is provided, defaults apply:
    // - mock: false (VITE_PURSER_MOCK not set)
    // - apiBase: '/api/v1' (fallback)
    expect(mod.config.mock).toBe(false);
    expect(mod.config.apiBase).toBe('/api/v1');
    expect(mod.config.oidc).toBeNull();
  });
});

describe('config.oidc — all &&-chain branches on L113', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('oidc is null when issuer + clientId are set but redirectUri is absent (L113 4th && — redirectUri falsy)', async () => {
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: { issuer: 'https://idp.example.com', clientId: 'purser-ui' },
      },
    });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    // issuer✓ && clientId✓ && redirectUri✗ → falsy → oidc: null
    expect(mod.config.oidc).toBeNull();
  });

  it('oidc is null when rt.oidc exists but issuer is absent (L113 2nd && — issuer falsy)', async () => {
    // rt.oidc is truthy (an object) but rt.oidc.issuer is undefined → short-circuits at 2nd &&
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: {},  // oidc object present but completely empty
      },
    });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    // rt.oidc is {} (truthy) && rt.oidc.issuer is undefined (falsy) → null
    expect(mod.config.oidc).toBeNull();
  });

  it('oidc is null when issuer is set but clientId is absent (L113 3rd && — clientId falsy)', async () => {
    // rt.oidc.issuer is truthy but rt.oidc.clientId is undefined → short-circuits at 3rd &&
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: { issuer: 'https://idp.example.com' },  // only issuer, no clientId
      },
    });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    // issuer✓ && clientId✗ → falsy → oidc: null
    expect(mod.config.oidc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutation killers — resolveBase edge cases (L68/L72/L80) and isTruthyFlag (L85)
// ---------------------------------------------------------------------------

describe('resolveBase — empty and whitespace-only runtimeVal uses fallback (L68/L69 mutations)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('uses fallback when apiBase is empty string "" (L68 ConditionalExpression/EqualityOperator)', async () => {
    // Mutations: `> 0` → `true` (always use runtime) or `>= 0` (0 >= 0 is true for empty string)
    // With mutation, empty string "" would be used → config.apiBase = "" instead of fallback.
    vi.stubGlobal('window', { __PURSER_CONFIG__: { apiBase: '' } });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('/api/v1');
  });

  it('uses fallback when apiBase is whitespace-only " " (L68 MethodExpression trim)', async () => {
    // Mutation: `runtimeVal.trim()` → `runtimeVal` — without trim, " ".length > 0 is true
    // So whitespace-only string would be used instead of falling through to fallback.
    vi.stubGlobal('window', { __PURSER_CONFIG__: { apiBase: '   ' } });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('/api/v1');
  });

  it('strips only slashes (not spaces) on return path (L69 MethodExpression trim)', async () => {
    // Mutation at L69: `runtimeVal.trim()` → `runtimeVal` — return value not trimmed
    // Test: apiBase with leading/trailing spaces should be stripped and return trimmed value.
    vi.stubGlobal('window', { __PURSER_CONFIG__: { apiBase: '  https://api.example.com/v1  ' } });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    // trimTrailingSlash + trim → clean URL without spaces
    expect(mod.config.apiBase).toBe('https://api.example.com/v1');
  });
});

describe('resolveBase — empty and whitespace env var uses fallback (L72/L73 mutations)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses fallback when VITE_PURSER_API_BASE is empty string (L72 ConditionalExpression/EqualityOperator)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_API_BASE', '');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('/api/v1');
  });

  it('uses fallback when VITE_PURSER_API_BASE is whitespace-only (L72 MethodExpression trim)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_API_BASE', '   ');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('/api/v1');
  });

  it('trims and returns env var value (L73 MethodExpression trim on return)', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_API_BASE', '  https://env-api.example.com/api/v1  ');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('https://env-api.example.com/api/v1');
  });
});

describe('trimTrailingSlash — multiple trailing slashes (L80 Regex mutation)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('strips multiple trailing slashes from apiBase (L80 /\\/+$/ → /\\/$/ kills single-slash only)', async () => {
    // Mutation: `/\/+$/` → `/\/$/` — only removes one trailing slash, not multiple.
    // Test: pass URL with three trailing slashes → expect all stripped.
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: { apiBase: 'https://example.com////' },
    });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.apiBase).toBe('https://example.com');
  });
});

describe('isTruthyFlag — whitespace-padded values (L85 MethodExpression trim)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mock is true when VITE_PURSER_MOCK=" 1 " (L85 trim mutation — without trim " 1 " ≠ "1")', async () => {
    // Mutation: `String(v ?? '').trim().toLowerCase()` → `String(v ?? '').toLowerCase()`
    // Without trim: " 1 " is not equal to "1" → returns false (wrong).
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', ' 1 ');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });

  it('mock is true when VITE_PURSER_MOCK=" true " (L85 trim — " true " trimmed to "true")', async () => {
    vi.stubGlobal('window', { __PURSER_CONFIG__: {} });
    vi.stubEnv('VITE_PURSER_MOCK', '  true  ');
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.mock).toBe(true);
  });
});

describe('config.oidc — truthy branch via resetModules (L114)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('oidc non-null path covered via resetModules (L114)', async () => {
    vi.stubGlobal('window', {
      __PURSER_CONFIG__: {
        oidc: {
          issuer: 'https://idp.reset.example.com',
          clientId: 'purser-reset',
          redirectUri: 'https://app.reset.example.com/callback',
        },
      },
    });
    vi.resetModules();
    const mod = await import('../config') as typeof ConfigModule;
    expect(mod.config.oidc).not.toBeNull();
    expect(mod.config.oidc?.issuer).toBe('https://idp.reset.example.com');
    expect(mod.config.oidc?.clientId).toBe('purser-reset');
    expect(mod.config.oidc?.redirectUri).toBe('https://app.reset.example.com/callback');
  });
});
