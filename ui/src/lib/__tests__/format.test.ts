import { describe, expect, it } from 'vitest';
import {
  billions,
  clamp,
  formatTokenCount,
  gb,
  percent,
  range,
  relativeTime,
  timeUntil,
  tokS,
} from '../format';

// ---------------------------------------------------------------------------
// gb
// ---------------------------------------------------------------------------
describe('gb', () => {
  it('formats with default 0 digits', () => {
    expect(gb(4)).toBe('4 GB');
  });

  it('formats with explicit digits', () => {
    expect(gb(1.5, 1)).toBe('1.5 GB');
  });

  it('rounds to 0 decimal places by default', () => {
    expect(gb(3.7)).toBe('4 GB');
  });

  it('handles 0', () => {
    expect(gb(0)).toBe('0 GB');
  });

  it('formats large values', () => {
    expect(gb(256, 0)).toBe('256 GB');
  });
});

// ---------------------------------------------------------------------------
// tokS
// ---------------------------------------------------------------------------
describe('tokS', () => {
  it('rounds and appends tok/s suffix', () => {
    expect(tokS(42.7)).toBe('43 tok/s');
  });

  it('does not add decimal places', () => {
    expect(tokS(100)).toBe('100 tok/s');
  });

  it('rounds half-up', () => {
    expect(tokS(9.5)).toBe('10 tok/s');
  });

  it('handles 0', () => {
    expect(tokS(0)).toBe('0 tok/s');
  });
});

// ---------------------------------------------------------------------------
// range
// ---------------------------------------------------------------------------
describe('range', () => {
  it('shows tilde form when lo === hi after rounding', () => {
    expect(range(5, 5, 'GB')).toBe('~5 GB');
  });

  it('shows tilde form when fractional values round to same int', () => {
    // Math.round(4.3) = 4, Math.round(4.4) = 4 → lo === hi → tilde
    expect(range(4.3, 4.4, 'ms')).toBe('~4 ms');
  });

  it('shows dash form when lo !== hi', () => {
    expect(range(3, 7, 'GB')).toBe('3–7 GB');
  });

  it('rounds both values before comparing', () => {
    expect(range(3.2, 7.8, 'tok/s')).toBe('3–8 tok/s');
  });

  it('handles unit with spaces', () => {
    expect(range(10, 20, 'tok/s')).toBe('10–20 tok/s');
  });
});

// ---------------------------------------------------------------------------
// percent
// ---------------------------------------------------------------------------
describe('percent', () => {
  it('formats with default 0 digits', () => {
    expect(percent(0.75)).toBe('75%');
  });

  it('formats with explicit digits', () => {
    expect(percent(0.755, 1)).toBe('75.5%');
  });

  it('handles 0', () => {
    expect(percent(0)).toBe('0%');
  });

  it('handles 1.0 (100%)', () => {
    expect(percent(1)).toBe('100%');
  });

  it('handles digits=2', () => {
    expect(percent(0.1234, 2)).toBe('12.34%');
  });
});

// ---------------------------------------------------------------------------
// timeUntil — deterministic via explicit `now` parameter
// ---------------------------------------------------------------------------
describe('timeUntil', () => {
  const now = new Date('2024-06-15T12:00:00.000Z');
  /** Return ISO string for a timestamp `deltaSecs` seconds in the future. */
  const fut = (deltaSecs: number) =>
    new Date(now.getTime() + deltaSecs * 1000).toISOString();

  it('returns "now" for a past timestamp (negative delta)', () => {
    expect(timeUntil(fut(-100), now)).toBe('now');
  });

  it('returns "now" for exactly 0 seconds', () => {
    expect(timeUntil(fut(0), now)).toBe('now');
  });

  it('returns "now" for 4 seconds (< 5 boundary)', () => {
    expect(timeUntil(fut(4), now)).toBe('now');
  });

  it('returns "in Ns" for 5 seconds (= 5 boundary, first non-"now")', () => {
    expect(timeUntil(fut(5), now)).toBe('in 5s');
  });

  it('returns "in Ns" for 59 seconds (< 60 boundary)', () => {
    expect(timeUntil(fut(59), now)).toBe('in 59s');
  });

  it('returns "in Nm" for 60 seconds (= 60 boundary, first minute)', () => {
    expect(timeUntil(fut(60), now)).toBe('in 1m');
  });

  it('returns "in Nm" for 5 minutes', () => {
    expect(timeUntil(fut(300), now)).toBe('in 5m');
  });

  it('returns "in Nh" for 3600 seconds (= 60 min boundary, first hour)', () => {
    expect(timeUntil(fut(3600), now)).toBe('in 1h');
  });

  it('returns "in Nh" for 2 hours', () => {
    expect(timeUntil(fut(7200), now)).toBe('in 2h');
  });

  it('returns "in Nd" for 86400 seconds (= 24 h boundary, first day)', () => {
    expect(timeUntil(fut(86_400), now)).toBe('in 1d');
  });

  it('returns "in Nd" for 3 days', () => {
    expect(timeUntil(fut(86_400 * 3), now)).toBe('in 3d');
  });
});

// ---------------------------------------------------------------------------
// relativeTime — deterministic via explicit `now` parameter
// ---------------------------------------------------------------------------
describe('relativeTime', () => {
  const now = new Date('2024-06-15T12:00:00.000Z');
  /** Return ISO string for a timestamp `deltaSecs` seconds in the past. */
  const past = (deltaSecs: number) =>
    new Date(now.getTime() - deltaSecs * 1000).toISOString();

  it('returns "just now" for a future timestamp (negative past delta)', () => {
    expect(relativeTime(past(-100), now)).toBe('just now');
  });

  it('returns "just now" for exactly 0 seconds', () => {
    expect(relativeTime(past(0), now)).toBe('just now');
  });

  it('returns "just now" for 4 seconds ago (< 5 boundary)', () => {
    expect(relativeTime(past(4), now)).toBe('just now');
  });

  it('returns "Ns ago" for 5 seconds ago (= 5 boundary)', () => {
    expect(relativeTime(past(5), now)).toBe('5s ago');
  });

  it('returns "Ns ago" for 59 seconds ago', () => {
    expect(relativeTime(past(59), now)).toBe('59s ago');
  });

  it('returns "Nm ago" for 60 seconds ago (= 60 boundary)', () => {
    expect(relativeTime(past(60), now)).toBe('1m ago');
  });

  it('returns "Nm ago" for 5 minutes ago', () => {
    expect(relativeTime(past(300), now)).toBe('5m ago');
  });

  it('returns "Nh ago" for 3600 seconds ago (= 60 min boundary)', () => {
    expect(relativeTime(past(3600), now)).toBe('1h ago');
  });

  it('returns "Nh ago" for 2 hours ago', () => {
    expect(relativeTime(past(7200), now)).toBe('2h ago');
  });

  it('returns "Nd ago" for 86400 seconds ago (= 24 h boundary)', () => {
    expect(relativeTime(past(86_400), now)).toBe('1d ago');
  });

  it('returns "Nd ago" for 5 days ago', () => {
    expect(relativeTime(past(86_400 * 5), now)).toBe('5d ago');
  });
});

// ---------------------------------------------------------------------------
// billions
// ---------------------------------------------------------------------------
describe('billions', () => {
  it('formats 7 (integer) as "7B"', () => {
    expect(billions(7)).toBe('7B');
  });

  it('formats 7.5 (fractional) as "7.5B"', () => {
    expect(billions(7.5)).toBe('7.5B');
  });

  it('formats 0 (integer) as "0B"', () => {
    expect(billions(0)).toBe('0B');
  });

  it('formats 1.0 (integer, % 1 === 0) as "1B" not "1.0B"', () => {
    expect(billions(1.0)).toBe('1B');
  });

  it('formats 13 (integer) as "13B"', () => {
    expect(billions(13)).toBe('13B');
  });

  it('formats 70 (integer) as "70B"', () => {
    expect(billions(70)).toBe('70B');
  });

  it('formats 3.14 (fractional) with 1 decimal place', () => {
    expect(billions(3.14)).toBe('3.1B');
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------
describe('clamp', () => {
  it('returns value when inside range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns lo when value is below lo', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns hi when value is above hi', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns lo when value equals lo', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns hi when value equals hi', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('returns lo when lo === hi', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('returns lo when lo === hi and value is below', () => {
    expect(clamp(1, 3, 3)).toBe(3);
  });

  it('returns lo when lo === hi and value is above', () => {
    expect(clamp(10, 3, 3)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatTokenCount
// ---------------------------------------------------------------------------
describe('formatTokenCount', () => {
  it('formats 0 as "0"', () => {
    expect(formatTokenCount(0)).toBe('0');
  });

  it('formats values below 1000 as plain string', () => {
    expect(formatTokenCount(42)).toBe('42');
  });

  it('formats 999 (just below 1K threshold) as "999"', () => {
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats 1000 (= 1K threshold) as "1.0K"', () => {
    expect(formatTokenCount(1_000)).toBe('1.0K');
  });

  it('formats 1001 (just above 1K threshold) as "1.0K"', () => {
    expect(formatTokenCount(1_001)).toBe('1.0K');
  });

  it('formats 1500 as "1.5K"', () => {
    expect(formatTokenCount(1_500)).toBe('1.5K');
  });

  it('formats 10000 as "10.0K"', () => {
    expect(formatTokenCount(10_000)).toBe('10.0K');
  });

  it('formats 999_999 (just below 1M threshold) as "1000.0K"', () => {
    // 999999 / 1000 = 999.999 → toFixed(1) = "1000.0" (JS rounding behaviour)
    expect(formatTokenCount(999_999)).toBe('1000.0K');
  });

  it('formats 1_000_000 (= 1M threshold) as "1.0M"', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
  });

  it('formats 1_000_001 (just above 1M threshold) as "1.0M"', () => {
    expect(formatTokenCount(1_000_001)).toBe('1.0M');
  });

  it('formats 5_500_000 as "5.5M"', () => {
    expect(formatTokenCount(5_500_000)).toBe('5.5M');
  });

  it('formats negative numbers below 1000 as plain string', () => {
    expect(formatTokenCount(-1)).toBe('-1');
  });
});
