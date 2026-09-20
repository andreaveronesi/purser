import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import type { TFunc } from '../../i18n';
import type { StringKey } from '../../i18n/en';
import { errorMessage } from '../errors';

// Identity t-function: returns the key as-is so we can assert which key was chosen.
const t: TFunc = (k) => k;

// A valid fallback key used throughout these tests.
const fallback = 'error.fleet' as StringKey;

// ---------------------------------------------------------------------------
// ApiError — status-specific branches
// ---------------------------------------------------------------------------
describe('errorMessage — ApiError branches', () => {
  it('returns t("error.network") for status 0 (transport failure)', () => {
    const err = new ApiError(0, 'Network error');
    expect(errorMessage(err, t, fallback)).toBe('error.network');
  });

  it('returns t("error.401") for status 401', () => {
    const err = new ApiError(401, 'Unauthorized');
    expect(errorMessage(err, t, fallback)).toBe('error.401');
  });

  it('returns t("error.403") for status 403', () => {
    const err = new ApiError(403, 'Forbidden');
    expect(errorMessage(err, t, fallback)).toBe('error.403');
  });

  it('returns t(fallbackKey) for status 404 (context message is the right 404 text)', () => {
    const err = new ApiError(404, 'Not found');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('returns t("error.429") for status 429', () => {
    const err = new ApiError(429, 'Too many requests');
    expect(errorMessage(err, t, fallback)).toBe('error.429');
  });

  it('returns t("error.503") for status 503', () => {
    const err = new ApiError(503, 'Service unavailable');
    expect(errorMessage(err, t, fallback)).toBe('error.503');
  });

  it('returns t("error.504") for status 504', () => {
    const err = new ApiError(504, 'Gateway timeout');
    expect(errorMessage(err, t, fallback)).toBe('error.504');
  });
});

// ---------------------------------------------------------------------------
// ApiError — default branch (all other statuses)
// ---------------------------------------------------------------------------
describe('errorMessage — ApiError default branch', () => {
  it('returns the specific server message when it is not a generic "HTTP N" message', () => {
    const err = new ApiError(500, 'disk quota exceeded');
    expect(errorMessage(err, t, fallback)).toBe('disk quota exceeded');
  });

  it('returns t(fallbackKey) when the message is a generic "HTTP 500"', () => {
    const err = new ApiError(500, 'HTTP 500');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('returns t(fallbackKey) when the message is empty', () => {
    const err = new ApiError(500, '');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('returns the specific message for status 402 (license / payment)', () => {
    const err = new ApiError(402, 'license key required');
    expect(errorMessage(err, t, fallback)).toBe('license key required');
  });

  it('returns t(fallbackKey) for 402 with generic "HTTP 402" message', () => {
    const err = new ApiError(402, 'HTTP 402');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('returns the specific message for status 422', () => {
    const err = new ApiError(422, 'validation failed: field "name" required');
    expect(errorMessage(err, t, fallback)).toBe('validation failed: field "name" required');
  });

  it('returns t(fallbackKey) for 422 with generic "HTTP 422" message', () => {
    const err = new ApiError(422, 'HTTP 422');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('the "HTTP N" regex does NOT match messages with trailing text ($ anchor)', () => {
    const err = new ApiError(500, 'HTTP 500 internal error');
    expect(errorMessage(err, t, fallback)).toBe('HTTP 500 internal error');
  });

  it('the "HTTP N" regex does NOT match messages where pattern appears at the end but not start (^ anchor)', () => {
    // "an error HTTP 500" ends with "HTTP 500" but does not START with it.
    // /^HTTP \d+$/ must NOT match → specific message is returned.
    // Without the ^ anchor (/HTTP \d+$/) it WOULD match → wrong: fallback returned.
    const err = new ApiError(500, 'an error HTTP 500');
    expect(errorMessage(err, t, fallback)).toBe('an error HTTP 500');
  });
});

// ---------------------------------------------------------------------------
// Non-ApiError inputs
// ---------------------------------------------------------------------------
describe('errorMessage — non-ApiError inputs', () => {
  it('returns t(fallbackKey) for a plain Error', () => {
    const err = new Error('something went wrong');
    expect(errorMessage(err, t, fallback)).toBe('error.fleet');
  });

  it('returns t(fallbackKey) for a string error', () => {
    expect(errorMessage('some string error', t, fallback)).toBe('error.fleet');
  });

  it('returns t(fallbackKey) for null', () => {
    expect(errorMessage(null, t, fallback)).toBe('error.fleet');
  });

  it('returns t(fallbackKey) for undefined', () => {
    expect(errorMessage(undefined, t, fallback)).toBe('error.fleet');
  });

  it('returns t(fallbackKey) for a number', () => {
    expect(errorMessage(42, t, fallback)).toBe('error.fleet');
  });
});

// ---------------------------------------------------------------------------
// Different fallback keys — ensure t(fallbackKey) propagates the right key
// ---------------------------------------------------------------------------
describe('errorMessage — fallbackKey propagation', () => {
  it('uses the supplied fallbackKey for 404', () => {
    const err = new ApiError(404, 'not found');
    expect(errorMessage(err, t, 'error.model' as StringKey)).toBe('error.model');
  });

  it('uses the supplied fallbackKey for generic Error', () => {
    const err = new Error('oops');
    expect(errorMessage(err, t, 'error.catalog' as StringKey)).toBe('error.catalog');
  });
});
