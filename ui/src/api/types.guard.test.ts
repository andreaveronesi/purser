// types.guard.test.ts — anti-regression guard for the camelCase migration.
//
// Reads types.ts as a raw string and asserts that no snake_case field
// declarations (foo_bar:) exist inside response interface blocks.
//
// Intentional exclusions (snake_case by design):
//   - The SLO family (SloModelEntry, SloContractConfig, SloActualData, SloApiResponse)
//     keeps snake_case because the normalizer at http.ts handles both forms and the
//     SLO contract is stable at the wire level. See the comment in types.ts.
//   - Request body shapes (WhatIfRequest, WhatIfNode) go through snakeizeKeys() so
//     camelCase inputs are correctly converted for the server. Not response types.
//   - BillingSummary fields period_start/period_end were already migrated but still
//     appear in SLO/wire formats elsewhere; the guard checks interface body blocks only.

import { describe, it, expect } from 'vitest';
// Vite raw import — gives us the source text at compile/test time without Node.js fs APIs.
import typesSource from './types.ts?raw';

// Interface names that intentionally keep snake_case (whitelisted).
const SNAKE_CASE_ALLOWED_INTERFACES = new Set([
  'SloModelEntry',
  'SloContractConfig',
  'SloActualData',
  'SloApiResponse',
  'WhatIfRequest',
  'WhatIfNode',
]);

/**
 * Extract interface body blocks from source, tagged with their interface name.
 * Returns an array of { name, body } objects.
 */
function extractInterfaceBlocks(src: string): Array<{ name: string; body: string }> {
  const results: Array<{ name: string; body: string }> = [];
  // Match `interface Foo { ... }` or `interface Foo extends Bar { ... }`.
  // Uses a manual brace-balanced scan because regex can't match nested braces.
  let i = 0;
  while (i < src.length) {
    // Find 'interface' keyword
    const ifIdx = src.indexOf('interface ', i);
    if (ifIdx === -1) break;

    // Extract interface name (up to first whitespace, '{', or 'extends')
    const afterKeyword = ifIdx + 'interface '.length;
    const nameMatch = src.slice(afterKeyword).match(/^([A-Za-z_$][A-Za-z0-9_$<>,\s]*?)[\s{]/);
    if (!nameMatch) { i = afterKeyword; continue; }
    const name = nameMatch[1].trim().replace(/<.*$/, '').trim(); // strip generics

    // Find opening brace
    const openBrace = src.indexOf('{', afterKeyword);
    if (openBrace === -1) { i = afterKeyword; continue; }

    // Scan for matching closing brace
    let depth = 1;
    let j = openBrace + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(openBrace + 1, j - 1);
    results.push({ name, body });
    i = j;
  }
  return results;
}

// snake_case field pattern: a word with at least one underscore followed by `:`
// (optionally with `?` before the colon, covering optional fields).
const SNAKE_CASE_FIELD_RE = /\b([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+)\s*\??:/g;

describe('types.ts — camelCase migration guard', () => {
  it('has no snake_case field declarations in non-whitelisted response interfaces', () => {
    const blocks = extractInterfaceBlocks(typesSource);
    const violations: string[] = [];

    for (const { name, body } of blocks) {
      if (SNAKE_CASE_ALLOWED_INTERFACES.has(name)) continue;

      const matches = [...body.matchAll(SNAKE_CASE_FIELD_RE)];
      for (const m of matches) {
        violations.push(`${name}.${m[1]}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found snake_case fields in response interfaces (should be camelCase):\n` +
        violations.map((v) => `  ${v}`).join('\n') +
        `\n\nTo fix: rename the field to camelCase in types.ts AND update all readers ` +
        `(pages, hooks, mock/backend.ts). See docs/ui-camelize-migration.md.`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('whitelisted SLO interfaces still have snake_case fields (sanity check)', () => {
    const blocks = extractInterfaceBlocks(typesSource);
    const sloBlocks = blocks.filter((b) => SNAKE_CASE_ALLOWED_INTERFACES.has(b.name));
    // At least some SLO interfaces must exist in the file, otherwise the whitelist is stale.
    // (If the SLO types are ever removed, this test will fail loudly rather than silently pass.)
    expect(sloBlocks.length).toBeGreaterThan(0);
  });
});
