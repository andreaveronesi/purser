// icons.test.tsx — parameterized smoke test: every exported icon renders an SVG.
// Low-value investment; one test per icon is sufficient per the M2 brief.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as Icons from '../icons';

const ICON_NAMES = Object.keys(Icons) as Array<keyof typeof Icons>;

describe('icons — all exports render an <svg>', () => {
  it.each(ICON_NAMES)('%s renders an svg element', (name) => {
    const Component = Icons[name];
    const { container } = render(<Component />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it.each(ICON_NAMES)('%s svg has aria-hidden=true', (name) => {
    const Component = Icons[name];
    const { container } = render(<Component />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it.each(ICON_NAMES)('%s svg has focusable=false', (name) => {
    const Component = Icons[name];
    const { container } = render(<Component />);
    expect(container.querySelector('svg')!.getAttribute('focusable')).toBe('false');
  });

  it('all icon exports have been tested (count guard)', () => {
    // A mutant that removes an export would reduce this count.
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(27);
  });
});
