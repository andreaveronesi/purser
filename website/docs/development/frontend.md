# Frontend: design tokens and layout

The operator dashboard (`ui/`) styles itself with **Tailwind CSS v4** driven by a
single set of design tokens. This page describes the conventions, because getting
a token name wrong fails silently and getting the page width wrong is invisible
until someone opens the dashboard on a large display.

## Node version

The UI targets **Node 22**, pinned in `ui/.nvmrc` and declared in
`ui/package.json` (`engines`) to match CI.

The pin documents the supported version; it is no longer load-bearing for the
test suite. From Node 22 onward Node ships its own global `localStorage`, and
because that implementation is file-backed it is inert without a valid
`--localstorage-file` — on Node 25 it shadowed jsdom's Storage and roughly 360
tests failed before any code change. `src/test/setup.ts` now installs a
deterministic in-memory Storage instead of trusting whatever the host provides,
so the suite passes on Node 22 and 25 alike.

```bash
cd ui
nvm use          # reads .nvmrc
npm ci
npm run typecheck && npm test && npm run build
```

## How tokens work

Tokens live in **`ui/src/styles/tokens.css`**, inside Tailwind v4's `@theme`
block. Tailwind v4 is CSS-first: there is no `tailwind.config.js`. Every custom
property declared in `@theme` becomes two things at once:

- a real CSS variable, usable from hand-written CSS and inline styles —
  `color: var(--color-danger)`
- a generated utility class — `text-danger`, `bg-danger`, `border-danger`

That duality is the whole point of the arrangement. Before it, the token file and
Tailwind would have been two competing systems that drift apart.

### Naming: the namespace is not decoration

Tailwind decides which utility to generate from the variable's **prefix**:

| Prefix | Generates | Example |
|---|---|---|
| `--color-*` | colour utilities | `--color-accent` → `bg-accent` |
| `--text-*` | **font sizes** | `--text-sm` → `text-sm` |
| `--font-*` | font families | `--font-mono` → `font-mono` |
| `--radius-*` | border radius | `--radius-lg` → `rounded-lg` |
| `--shadow-*` | box shadows | `--shadow-card` → `shadow-card` |
| `--container-*` | max widths | `--container-narrow` → `max-w-narrow` |

The consequence that bites: **a colour must be `--color-text-muted`, never
`--text-muted`.** The second form registers a *font size* called `text-muted`.
The palette was renamed for exactly this reason.

!!! warning "A misspelled token fails silently"
    `var(--nope)` is not an error. The declaration is simply dropped and the
    element keeps its inherited value, so error text quietly renders in the body
    colour and a progress bar quietly renders with no fill. Before this
    convention landed, 44 inline styles across 11 pages referenced variables that
    did not exist.

    Utility classes do not have this failure mode — a nonexistent utility
    produces no class at all, which is visible. Prefer utilities for new work.

### Adding a token

Add it to the `@theme` block in `tokens.css` under the right prefix, then add the
dark-mode value to **both** override blocks below it (`[data-theme='dark']` and
the `prefers-color-scheme` block that covers first paint).

Dark-mode overrides deliberately sit **outside** `@theme`, as plain CSS
redefining the same variables. This is why the dashboard needs no `dark:`
variants anywhere: `bg-surface` compiles to
`background-color: var(--color-surface)`, so repointing that one variable
re-themes every utility and every hand-written rule together.

## Page width

Width is a property of the page, not a single global cap.

```html
<div class="page">                     <!-- default: full width -->
<div class="page page--narrow">        <!-- forms, guided flows -->
<div class="page page--prose">         <!-- long-form text, capped in ch -->
```

`.page` fills the available space. This matters because the dashboard's centre of
gravity is wide data: a dozen pages carry tables of six to nine columns, and
under the previous fixed cap those overflowed into horizontal scroll while
single-column forms sprawled across the same box.

Cap a page only when its content is genuinely a single column of fields or prose.
A page built on `.grid--2` or `.grid--cards` should **not** be capped — both
grids use `auto-fit`, so they add columns as room appears, which is the behaviour
you want.

Line length is still bounded where it matters: prose caps are expressed in `ch`
(character count), not pixels, because that is what readability depends on.

## Formatting is locale-neutral

`src/lib/format.ts` opens by stating the rule: helpers are locale-neutral, so the
same value renders identically regardless of UI language. Use them.

Do **not** call `n.toLocaleString()` or `new Intl.NumberFormat()` with no locale
argument. Both read the *host machine's* locale, which has two consequences: the
identical build shows `8,400` to one operator and `8400` to another, and any test
asserting that output passes or fails depending on whose machine runs it. Pass an
explicit locale, or add a helper to `format.ts` — `integer()` is the grouped
whole-number case.

!!! note "Known gap"
    Sixteen call sites still format dates and counts through bare
    `toLocaleString()` / `toLocaleDateString()`. They break no test, because no
    test asserts their output, but they do mean a dashboard set to English shows
    dates in the operator's OS locale. Migrating them is open work.

## Numbers in tables

Table cells set `font-variant-numeric: tabular-nums`. Digits then occupy equal
width, so figures line up down a column and can be compared at a glance.
Proportional digits make a column of memory readings ragged. This applies to
`.table` and its alias `.data-table`.

## Tailwind's Preflight is not enabled

`tokens.css` imports Tailwind's theme and utilities layers but **not**
`preflight.css`, its opinionated reset.

`global.css` carries a hand-written reset that its own 1300+ lines depend on, and
this repo has no visual-regression tooling — tests run in jsdom, which does not
compute layout, so a reset conflict could not be caught by any test. Adopting
Preflight is a deliberate change to be made with a browser open, not a
side-effect of installing Tailwind.

## Air-gap guarantee

Tailwind is compiled at build time by `@tailwindcss/vite`. The **CDN "play"
script must never be used**, and no web font may be fetched at runtime: the
dashboard has to work in a disconnected deployment, which is also why Purser
verifies licences offline. Any typeface must be self-hosted and bundled.

Adding Tailwind cost about 5 KB of CSS and **zero** JavaScript — the JS bundle is
unchanged, because none of it ships to the browser.
