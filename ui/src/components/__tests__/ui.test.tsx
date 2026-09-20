// ui.test.tsx — comprehensive unit tests for shared UI primitives in ui.tsx.
// Strategy: mock the i18n layer so assertions pin raw translation keys; each
// component is tested in isolation via render() with no router needed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// i18n mock — assert on raw keys; avoids needing a real provider per test.
// ---------------------------------------------------------------------------
vi.mock('../../i18n', () => ({
  useT: () => (k: string) => k,
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (k: string) => k }),
  I18nProvider: ({ children }: { children: ReactNode }) => children,
}));

import {
  Badge,
  Button,
  Card,
  CodeBlock,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Meter,
  Modal,
  PageHeader,
  ProgressBar,
  Spinner,
  StatusPill,
  TabPanel,
  Tabs,
} from '../ui';
import type { Tone } from '../ui';
import type { NodeState } from '../../api/types';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

describe('Button', () => {
  it('renders default variant+size class names', () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn--secondary');
    expect(btn.className).toContain('btn--md');
  });

  it.each<[string, string]>([
    ['primary', 'btn--primary'],
    ['secondary', 'btn--secondary'],
    ['ghost', 'btn--ghost'],
    ['danger', 'btn--danger'],
  ])('variant %s → class %s', (variant, cls) => {
    render(<Button variant={variant as 'primary' | 'secondary' | 'ghost' | 'danger'}>x</Button>);
    expect(screen.getByRole('button').className).toContain(cls);
  });

  it.each<[string, string]>([
    ['sm', 'btn--sm'],
    ['md', 'btn--md'],
  ])('size %s → class %s', (size, cls) => {
    render(<Button size={size as 'sm' | 'md'}>x</Button>);
    expect(screen.getByRole('button').className).toContain(cls);
  });

  it('fires onClick when enabled', () => {
    const spy = vi.fn();
    render(<Button onClick={spy}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onClick when disabled', () => {
    const spy = vi.fn();
    render(<Button disabled onClick={spy}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes aria-label through', () => {
    render(<Button aria-label="custom-label">x</Button>);
    expect(screen.getByRole('button', { name: 'custom-label' })).toBeDefined();
  });

  it('has type=button by default (prevents accidental form submit)', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('accepts extra className without overwriting btn classes', () => {
    render(<Button className="my-class">x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('btn');
    expect(cls).toContain('my-class');
  });
});

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

describe('PageHeader', () => {
  it('renders required title', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Page');
  });

  it('renders subtitle when provided', () => {
    render(<PageHeader title="My Page" subtitle="a subtitle" />);
    expect(screen.getByText('a subtitle')).toBeDefined();
  });

  it('does NOT render subtitle when omitted', () => {
    render(<PageHeader title="My Page" />);
    expect(document.querySelector('.page-header__subtitle')).toBeNull();
  });

  it('renders actions slot when provided', () => {
    render(<PageHeader title="My Page" actions={<button>Act</button>} />);
    expect(screen.getByRole('button', { name: 'Act' })).toBeDefined();
  });

  it('does NOT render actions slot when omitted', () => {
    render(<PageHeader title="My Page" />);
    expect(document.querySelector('.page-header__actions')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

describe('Card', () => {
  it('renders children', () => {
    render(<Card>body content</Card>);
    expect(screen.getByText('body content')).toBeDefined();
  });

  it('renders header when title is provided', () => {
    render(<Card title="Card Title">body</Card>);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Card Title');
  });

  it('renders header when action is provided even without title', () => {
    render(<Card action={<button>Action</button>}>body</Card>);
    expect(document.querySelector('.card__head')).not.toBeNull();
  });

  it('does NOT render header when neither title nor action provided', () => {
    render(<Card>body</Card>);
    expect(document.querySelector('.card__head')).toBeNull();
  });

  it('appends extra className to card', () => {
    render(<Card className="custom">body</Card>);
    expect(document.querySelector('.card.custom')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

describe('Badge', () => {
  const tones: Tone[] = ['neutral', 'success', 'warning', 'danger', 'info'];

  it.each(tones)('tone %s → badge--%s class', (tone) => {
    render(<Badge tone={tone}>text</Badge>);
    expect(document.querySelector(`.badge--${tone}`)).not.toBeNull();
  });

  it('defaults to neutral tone', () => {
    render(<Badge>text</Badge>);
    expect(document.querySelector('.badge--neutral')).not.toBeNull();
  });

  it('renders children', () => {
    render(<Badge>my label</Badge>);
    expect(screen.getByText('my label')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// StatusPill
// ---------------------------------------------------------------------------

const ALL_STATES: NodeState[] = [
  'provisioning',
  'enrolled',
  'ready',
  'loading',
  'running',
  'degraded',
  'draining',
  'unreachable',
  'decommissioned',
];

const EXPECTED_TONES: Record<NodeState, string> = {
  provisioning:    'info',
  enrolled:        'info',
  ready:           'success',
  loading:         'info',
  running:         'success',
  degraded:        'warning',
  draining:        'warning',
  unreachable:     'danger',
  decommissioned:  'neutral',
};

describe('StatusPill', () => {
  it.each(ALL_STATES)('state %s → correct tone class and i18n key', (state) => {
    const { container } = render(<StatusPill state={state} />);
    const pill = container.querySelector('.pill');
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain(`pill--${EXPECTED_TONES[state]}`);
    // The i18n mock returns the key verbatim; check it is rendered.
    expect(screen.getByText(`state.${state}`)).toBeDefined();
  });

  it('does not crash for an unknown state (runtime coercion from API)', () => {
    // TypeScript won't allow this directly, but runtime data can have unknowns.
    expect(() =>
      render(<StatusPill state={'unknown_state' as NodeState} />)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Spinner / LoadingBlock
// ---------------------------------------------------------------------------

describe('Spinner', () => {
  it('renders a status role', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders default loading key from i18n', () => {
    render(<Spinner />);
    // i18n mock returns the key; common.loading is the default label
    expect(screen.getByText('common.loading')).toBeDefined();
  });

  it('renders custom label when provided', () => {
    render(<Spinner label="Please wait" />);
    expect(screen.getByText('Please wait')).toBeDefined();
  });
});

describe('LoadingBlock', () => {
  it('renders default loading key from i18n', () => {
    render(<LoadingBlock />);
    // The visible text (outside visually-hidden span) comes from LoadingBlock
    // itself; Spinner's label is inside visually-hidden, LoadingBlock adds its own.
    const block = document.querySelector('.loading-block');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('common.loading');
  });

  it('renders custom label when provided', () => {
    render(<LoadingBlock label="Syncing..." />);
    const block = document.querySelector('.loading-block');
    expect(block!.textContent).toContain('Syncing...');
  });
});

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

describe('ErrorState', () => {
  it('renders role="alert" for screen readers', () => {
    render(<ErrorState message="oops" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('renders the message', () => {
    render(<ErrorState message="Network error" />);
    expect(screen.getByText('Network error')).toBeDefined();
  });

  it('renders default title from i18n when none provided', () => {
    render(<ErrorState message="oops" />);
    expect(screen.getByText('error.title')).toBeDefined();
  });

  it('renders custom title when provided', () => {
    render(<ErrorState title="Custom title" message="oops" />);
    expect(screen.getByText('Custom title')).toBeDefined();
  });

  it('renders retry button when onRetry provided', () => {
    const spy = vi.fn();
    render(<ErrorState message="oops" onRetry={spy} />);
    // i18n mock returns the key; action.retry is the button label
    expect(screen.getByRole('button', { name: 'action.retry' })).toBeDefined();
  });

  it('calls onRetry when retry button clicked', () => {
    const spy = vi.fn();
    render(<ErrorState message="oops" onRetry={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'action.retry' }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT render retry button when onRetry omitted', () => {
    render(<ErrorState message="oops" />);
    expect(screen.queryByRole('button', { name: 'action.retry' })).toBeNull();
  });

  it('renders custom action slot', () => {
    render(<ErrorState message="oops" action={<button>Custom</button>} />);
    expect(screen.getByRole('button', { name: 'Custom' })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

describe('EmptyState', () => {
  it('renders the message', () => {
    render(<EmptyState message="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  it('renders default title from i18n when none provided', () => {
    render(<EmptyState message="Nothing" />);
    expect(screen.getByText('empty.title')).toBeDefined();
  });

  it('renders custom title when provided', () => {
    render(<EmptyState title="All done" message="Nothing" />);
    expect(screen.getByText('All done')).toBeDefined();
  });

  it('renders icon slot when provided', () => {
    render(<EmptyState message="Nothing" icon={<span data-testid="icon" />} />);
    expect(document.querySelector('.empty-state__icon')).not.toBeNull();
  });

  it('does NOT render icon container when icon omitted', () => {
    render(<EmptyState message="Nothing" />);
    expect(document.querySelector('.empty-state__icon')).toBeNull();
  });

  it('renders action slot when provided', () => {
    render(<EmptyState message="Nothing" action={<button>Add</button>} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

describe('ProgressBar', () => {
  it('renders role="progressbar"', () => {
    render(<ProgressBar value={0.5} />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('sets aria-valuenow to rounded percentage', () => {
    render(<ProgressBar value={0.333} />);
    // 0.333 * 100 = 33.3, rounded = 33
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33');
  });

  it('aria-valuenow is 0 at value=0', () => {
    render(<ProgressBar value={0} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('aria-valuenow is 100 at value=1', () => {
    render(<ProgressBar value={1} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('fills width proportional to value', () => {
    render(<ProgressBar value={0.75} />);
    const fill = document.querySelector('.progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('75%');
  });

  it('passes aria-label through', () => {
    render(<ProgressBar value={0.5} label="disk usage" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('disk usage');
  });
});

// ---------------------------------------------------------------------------
// Meter (critical: null-guard, tone thresholds, aria-valuenow)
// ---------------------------------------------------------------------------

describe('Meter — null and zero guard', () => {
  // TDD: this test was written FIRST (failing) to document the crash risk
  // when the API returns null for nullable numeric fields (e.g. monthlyQuota).
  // The guard was then added to Meter. Test must stay green.
  it('does not crash when used is null (runtime API coercion)', () => {
    expect(() =>
      render(
        <Meter used={null as unknown as number} total={100} label="quota" />
      )
    ).not.toThrow();
  });

  it('does not crash when total is null (runtime API coercion)', () => {
    expect(() =>
      render(
        <Meter used={50} total={null as unknown as number} label="quota" />
      )
    ).not.toThrow();
  });

  it('does not crash when both are null', () => {
    expect(() =>
      render(
        <Meter
          used={null as unknown as number}
          total={null as unknown as number}
          label="quota"
        />
      )
    ).not.toThrow();
  });

  it('shows 0/0 when both are null', () => {
    render(
      <Meter
        used={null as unknown as number}
        total={null as unknown as number}
        label="quota"
      />
    );
    expect(screen.getByText(/0 \/ 0/)).toBeDefined();
  });

  it('total=0: ratio is 0, does not divide-by-zero or NaN the width', () => {
    render(<Meter used={0} total={0} label="ram" />);
    const fill = document.querySelector('.meter__fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(document.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('total=0: renders without throwing even if used > 0', () => {
    expect(() =>
      render(<Meter used={10} total={0} label="ram" />)
    ).not.toThrow();
  });
});

describe('Meter — tone thresholds', () => {
  // ratio = used / total; thresholds: >0.9 → danger, >0.7 → warning, else → ok

  function renderMeterRatio(ratio: number) {
    // Use total=1000 so exact ratios are hit with integer arithmetic
    return render(<Meter used={Math.round(ratio * 1000)} total={1000} label="test" />);
  }

  function getTone(container: HTMLElement): string {
    const track = container.querySelector('[class*="meter__track--"]');
    if (!track) return '';
    const m = track.className.match(/meter__track--(\w+)/);
    return m ? m[1] : '';
  }

  it('ratio < 0.7 → ok', () => {
    const { container } = renderMeterRatio(0.69);
    expect(getTone(container)).toBe('ok');
  });

  it('ratio = 0.7 (not >0.7) → ok', () => {
    const { container } = renderMeterRatio(0.7);
    expect(getTone(container)).toBe('ok');
  });

  it('ratio = 0.701 (>0.7) → warning', () => {
    const { container } = render(<Meter used={701} total={1000} label="test" />);
    expect(getTone(container)).toBe('warning');
  });

  it('ratio = 0.9 (not >0.9) → warning', () => {
    const { container } = renderMeterRatio(0.9);
    expect(getTone(container)).toBe('warning');
  });

  it('ratio = 0.901 (>0.9) → danger', () => {
    const { container } = render(<Meter used={901} total={1000} label="test" />);
    expect(getTone(container)).toBe('danger');
  });

  it('ratio = 1.0 → danger', () => {
    const { container } = renderMeterRatio(1.0);
    expect(getTone(container)).toBe('danger');
  });

  it('ratio = 0.0 → ok', () => {
    const { container } = renderMeterRatio(0.0);
    expect(getTone(container)).toBe('ok');
  });
});

describe('Meter — display values', () => {
  it('renders used/total text with correct values', () => {
    render(<Meter used={4} total={8} label="RAM" />);
    expect(screen.getByText(/4 \/ 8/)).toBeDefined();
  });

  it('renders the label', () => {
    render(<Meter used={1} total={2} label="VRAM" />);
    expect(screen.getByText('VRAM')).toBeDefined();
  });

  it('uses GB as default unit', () => {
    render(<Meter used={1} total={2} label="x" />);
    expect(screen.getByText(/GB/)).toBeDefined();
  });

  it('renders custom unit', () => {
    render(<Meter used={100} total={1000} label="quota" unit="req" />);
    expect(screen.getByText(/req/)).toBeDefined();
  });

  it('aria-valuenow is rounded ratio×100', () => {
    // used=1, total=3: ratio=0.333..., rounded=33
    render(<Meter used={1} total={3} label="x" />);
    expect(
      document.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')
    ).toBe('33');
  });

  it('meter fill is capped at 100% even when used > total', () => {
    render(<Meter used={150} total={100} label="x" />);
    const fill = document.querySelector('.meter__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });
});

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

describe('Field', () => {
  it('renders the label text', () => {
    render(<Field label="Email" htmlFor="email-input"><input id="email-input" /></Field>);
    expect(screen.getByText('Email')).toBeDefined();
  });

  it('connects label to input via htmlFor', () => {
    render(<Field label="Email" htmlFor="email-input"><input id="email-input" /></Field>);
    const label = document.querySelector('label');
    expect(label!.getAttribute('for')).toBe('email-input');
  });

  it('renders hint when provided', () => {
    render(
      <Field label="Name" htmlFor="name" hint="Max 50 chars">
        <input id="name" />
      </Field>
    );
    expect(screen.getByText('Max 50 chars')).toBeDefined();
  });

  it('does NOT render hint element when hint omitted', () => {
    render(<Field label="Name" htmlFor="name"><input id="name" /></Field>);
    expect(document.querySelector('.field__hint')).toBeNull();
  });

  it('renders children inside the field', () => {
    render(
      <Field label="Name" htmlFor="name">
        <input id="name" placeholder="Enter name" />
      </Field>
    );
    expect(screen.getByPlaceholderText('Enter name')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

describe('Tabs', () => {
  const TABS = [
    { id: 'a', label: 'Tab A' },
    { id: 'b', label: 'Tab B' },
    { id: 'c', label: 'Tab C' },
  ];

  it('renders all tabs', () => {
    render(<Tabs tabs={TABS} active="a" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab', { name: 'Tab A' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Tab B' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Tab C' })).toBeDefined();
  });

  it('active tab has aria-selected=true, others false', () => {
    render(<Tabs tabs={TABS} active="b" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab', { name: 'Tab A' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Tab B' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Tab C' }).getAttribute('aria-selected')).toBe('false');
  });

  it('active tab has tabIndex=0, others -1', () => {
    render(<Tabs tabs={TABS} active="b" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab', { name: 'Tab A' }).tabIndex).toBe(-1);
    expect(screen.getByRole('tab', { name: 'Tab B' }).tabIndex).toBe(0);
  });

  it('active tab has tab--active class', () => {
    render(<Tabs tabs={TABS} active="c" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab', { name: 'Tab C' }).className).toContain('tab--active');
    expect(screen.getByRole('tab', { name: 'Tab A' }).className).not.toContain('tab--active');
  });

  it('clicking a tab calls onChange with its id', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="a" onChange={onChange} ariaLabel="nav" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ArrowRight on last tab wraps to first', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="c" onChange={onChange} ariaLabel="nav" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tab C' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('ArrowLeft on first tab wraps to last', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="a" onChange={onChange} ariaLabel="nav" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tab A' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('ArrowRight advances to next tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="a" onChange={onChange} ariaLabel="nav" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tab A' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ArrowLeft moves to previous tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="c" onChange={onChange} ariaLabel="nav" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tab C' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('other keys do not call onChange', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="a" onChange={onChange} ariaLabel="nav" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tab A' }), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tablist has correct aria-label', () => {
    render(<Tabs tabs={TABS} active="a" onChange={vi.fn()} ariaLabel="my-tabs" />);
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('my-tabs');
  });

  it('inactive tabs have tabIndex=-1 and active has tabIndex=0', () => {
    render(<Tabs tabs={TABS} active="b" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab', { name: 'Tab A' }).tabIndex).toBe(-1);
    expect(screen.getByRole('tab', { name: 'Tab B' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Tab C' }).tabIndex).toBe(-1);
  });

  it('has aria-controls pointing to panel-<id>', () => {
    render(<Tabs tabs={[{ id: 'x', label: 'X' }]} active="x" onChange={vi.fn()} ariaLabel="nav" />);
    expect(screen.getByRole('tab').getAttribute('aria-controls')).toBe('panel-x');
  });

  it('has id=tab-<id> on each tab button', () => {
    render(<Tabs tabs={[{ id: 'x', label: 'X' }]} active="x" onChange={vi.fn()} ariaLabel="nav" />);
    expect(document.getElementById('tab-x')).not.toBeNull();
  });
});

describe('TabPanel', () => {
  it('renders children', () => {
    render(<TabPanel id="a">Panel content</TabPanel>);
    expect(screen.getByText('Panel content')).toBeDefined();
  });

  it('has role=tabpanel and correct ids', () => {
    const { container } = render(<TabPanel id="my-tab">content</TabPanel>);
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('id')).toBe('panel-my-tab');
    expect(panel!.getAttribute('aria-labelledby')).toBe('tab-my-tab');
  });
});

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

describe('Modal', () => {
  beforeEach(() => {
    // Modal renders into document.body via createPortal — ensure clean slate.
    document.body.innerHTML = '';
  });

  function renderModal(overrides: {
    title?: string;
    onClose?: () => void;
    footer?: ReactNode;
    children?: ReactNode;
  } = {}) {
    const onClose = overrides.onClose ?? vi.fn();
    render(
      <Modal
        title={overrides.title ?? 'Test Dialog'}
        onClose={onClose}
        footer={overrides.footer}
      >
        {overrides.children ?? <p>Modal body</p>}
      </Modal>
    );
    return { onClose };
  }

  it('renders the dialog role', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('renders the title', () => {
    renderModal({ title: 'Confirm delete' });
    expect(screen.getByText('Confirm delete')).toBeDefined();
  });

  it('renders children', () => {
    renderModal({ children: <p>Are you sure?</p> });
    expect(screen.getByText('Are you sure?')).toBeDefined();
  });

  it('renders footer when provided', () => {
    renderModal({ footer: <button>OK</button> });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDefined();
    expect(document.querySelector('.modal__foot')).not.toBeNull();
  });

  it('does NOT render footer when omitted', () => {
    renderModal();
    expect(document.querySelector('.modal__foot')).toBeNull();
  });

  it('calls onClose when Escape key pressed on document', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on backdrop mousedown', () => {
    const { onClose } = renderModal();
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the modal', () => {
    const { onClose } = renderModal();
    const modal = document.querySelector('.modal') as HTMLElement;
    fireEvent.mouseDown(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has aria-modal=true', () => {
    renderModal();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

describe('CopyButton', () => {
  beforeEach(() => {
    // Mock clipboard API (happy path)
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders a button with default copy label (i18n key)', () => {
    render(<CopyButton value="hello" />);
    expect(screen.getByRole('button', { name: 'action.copy' })).toBeDefined();
  });

  it('renders custom label when provided', () => {
    render(<CopyButton value="hello" label="Copy token" />);
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeDefined();
  });

  it('calls clipboard.writeText on click', async () => {
    render(<CopyButton value="secret-value" />);
    fireEvent.click(screen.getByRole('button'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret-value');
  });

  it('falls back to execCommand when clipboard API rejects', async () => {
    // Force the clipboard API to fail → triggers the textarea fallback path.
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('not allowed')
    );
    // jsdom does not implement execCommand; define a stub so we can spy on it.
    if (!document.execCommand) {
      Object.defineProperty(document, 'execCommand', {
        value: vi.fn().mockReturnValue(true),
        writable: true,
        configurable: true,
      });
    }
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    render(<CopyButton value="fallback-text" />);
    fireEvent.click(screen.getByRole('button'));

    // Wait for the async click handler to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(execSpy).toHaveBeenCalledWith('copy');

    execSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// useFieldId
// ---------------------------------------------------------------------------

describe('useFieldId', () => {
  // Test via Field component which calls useFieldId internally
  it('label htmlFor matches input id (stable across render)', () => {
    // Render a field and check the label's for attribute matches the input id.
    render(<Field label="Name" htmlFor="stable-id"><input id="stable-id" /></Field>);
    const label = document.querySelector('label');
    expect(label!.getAttribute('for')).toBe('stable-id');
  });
});

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

describe('CodeBlock', () => {
  it('renders code inside a <pre><code>', () => {
    render(<CodeBlock code="const x = 1" />);
    const code = document.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('const x = 1');
  });

  it('renders a copy button', () => {
    render(<CodeBlock code="x" />);
    // CopyButton renders with i18n key as aria-label
    expect(screen.getByRole('button', { name: 'action.copy' })).toBeDefined();
  });

  it('sets aria-label on the pre when provided', () => {
    render(<CodeBlock code="x" ariaLabel="Sample code" />);
    expect(document.querySelector('pre')!.getAttribute('aria-label')).toBe('Sample code');
  });
});
