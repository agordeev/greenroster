# shadcn/ui migration plan (web)

Written and reviewed 2026-10-12. Scope: `apps/web` only.

## Goal

1. **Look:** replace the cream / green / serif look with the stock shadcn light theme.
2. **Maintenance:** stop growing `apps/web/src/app/globals.css`. Pages are built from
   components in `src/components/ui/` plus Tailwind utilities; no page-prefixed CSS classes.

## Out of scope

- Native apps. The Expo app has been removed; this migration changes only the web app.
- Dark mode. The web app has none today; this plan stays light-only.
- Copy. No user-facing strings change. `tests/user-facing-copy.test.ts` must keep passing.
- Behaviour. No route, form action, or data change. Component replacements must preserve
  form values, validation, disabled states, keyboard operation, and focus restoration.

## Starting point (measured)

Measured against `fecbc2a` on 2026-10-12. Refresh the inventory before each sweep.

| Fact                                        | Value                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `globals.css`                               | 3,191 lines, the only CSS file under `apps/web/src`                                                                          |
| `.tsx` files under `apps/web/src`           | 105 (21,216 lines)                                                                                                           |
| `className=` attributes                     | 1,149                                                                                                                        |
| Tailwind                                    | v4 installed (`@import "tailwindcss"`), almost unused, no `@theme` block                                                     |
| shadcn pieces                               | none: no `components.json`, Radix, cva, tailwind-merge, `cn`                                                                 |
| Shared components                           | `src/components/ui.tsx`: `Field`, `SectionHeading`, `EmptyState`, `ActionRow` (36 importing files)                           |
| Colours                                     | legacy colour tokens in `globals.css`; 6 `rgb()/rgba()` values outside `:root`, plus the native select's embedded SVG colour |
| Serif headings                              | 52 `var(--font-ledger)` usages plus its declaration                                                                          |
| Native elements                             | 142 `<input>`, 85 `<button>`, 39 `<form>`, 20 `<select>`, 17 `<textarea>`, 15 `<table>`, 2 `<details>`                       |
| Input exceptions                            | 5 hidden-input declarations, 2 radio-input declarations, 32 checkbox declarations (26 controlled)                            |
| Shared button/link classes                  | `primary-button`, `secondary-button`, `danger-button`, `text-button`, `button-link`, and 14 `primary-link` usages            |
| Dialogs, tabs, toasts, tooltips, comboboxes | none                                                                                                                         |
| Tests tied to markup                        | `tests/web-accessibility-skip-link.test.ts` checks literal anchors, route-local link text, and main targets                  |
| Visual regression tests                     | none                                                                                                                         |

`className=` count by area, which sets the migration order and size:

| Area                                                                                         | Count |
| -------------------------------------------------------------------------------------------- | ----- |
| `portal/members`                                                                             | 211   |
| `portal/rounds`                                                                              | 197   |
| `portal` root (shell, dashboard, quota form)                                                 | 90    |
| other `portal/*` (group, standings, invitations, branding, billing, reports, content, quota) | 163   |
| `member`                                                                                     | 226   |
| sign-in, sign-up, recover-password, reset-password, invitations                              | 162   |
| `account`                                                                                    | 50    |

## Decisions taken (change these before Phase 1 if you disagree)

| Decision                 | Choice                                                        | Why                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Base colour              | Neutral                                                       | The stock shadcn look.                                                                                                                      |
| Primitives               | Radix                                                         | Select Radix explicitly during setup and retain that choice when adding components.                                                         |
| Font                     | Geist via `next/font`                                         | Stock shadcn look. Self-hosted, so the CSP `font-src 'self' data:` in `next.config.ts` needs no change.                                     |
| Control height           | 44px (`h-11`) for buttons and text inputs, not the stock 36px | Keeps the current `--control: 2.75rem`; member pages are used on phones and `docs/accessibility-release-checklist.md` covers touch targets. |
| Selects and date inputs  | Stay native (`NativeSelect`, `<Input type="date">`)           | They post inside server-action forms today.                                                                                                 |
| Radios and hidden inputs | Stay native                                                   | Radios keep their existing grouping and handlers; hidden inputs retain their form values without visual styling.                            |
| Checkboxes               | shadcn `Checkbox`, with explicit handler conversion           | Controlled boxes use `onCheckedChange`; names and submitted values remain unchanged.                                                        |
| E-mails                  | Recoloured in the last phase                                  | The 7 templates carry their own hex values and would otherwise keep the old look.                                                           |

## How the two looks coexist during migration

1. **Legacy rules move into a cascade layer.** Today the rules in `globals.css` are
   unlayered, so they beat Tailwind utilities. Moving the legacy rules into
   `@layer components` lets utilities override matching properties. Shared token names
   need explicit handling: an unlayered shadcn `:root` overrides a layered legacy `:root`.
2. **The look changes through tokens first.** Repointing the legacy colour tokens at
   shadcn variables restyles unconverted pages. The native select's embedded SVG needs
   a separate update. Component conversion still requires screenshot comparison because
   primitive padding, font sizes, and wrappers can change layout.

## Phase 0 — Baseline

- Start from a clean working tree. The tree was clean at this review; preserve any new
  work with a commit or stash before beginning the migration.
- Run `rtk pnpm check` and record that it passes.
- Capture screenshots of each route group at 1280x720, 768x900, and 375x812. Include
  authenticated pages and their error, success, disabled, and empty branches. Store
  screenshots outside the repo or in the ignored browser-artifact directory.
- Reuse the local browser lanes documented in `scripts/e2e/agent-browser/README.md`.
  Their smoke coverage does not replace checks for every route touched by a sweep.

## Phase 1 — Foundation (no visible change)

1. Read the font and CSS guides in `node_modules/next/dist/docs/` first, as
   `apps/web/AGENTS.md` requires for Next 16.
2. In `apps/web`, run `rtk pnpm dlx shadcn@latest init` with base colour Neutral and
   Radix primitives. Record the resolved CLI version and selected style in the PR so
   subsequent component additions use the same version and style. Point the `ui` alias
   at `src/components/ui` and the `utils` alias at `src/lib/utils`.
3. Move `src/components/ui.tsx` to `src/components/blocks.tsx` and update its 36
   importers. Reserve `src/components/ui/` for shadcn primitives.
4. Split the stylesheet:
   - `src/app/legacy.css` — the legacy tokens and existing rules, without the Tailwind
     import or the shared `--radius` / `--font-sans` declarations.
   - `src/app/globals.css` — the Tailwind import, generated supporting stylesheet
     imports, `@import "./legacy.css" layer(components);`, shadcn variables,
     `@theme inline`, and generated `@layer base` rules. Keep all imports at the top.
   - Keep one unlayered `--radius: 0.375rem` declaration through Phase 1. Do not use
     the generated radius until Phase 2, and never alias `--radius` to itself.
   - Keep `--font-sans: var(--font-club)` through Phase 1; do not load Geist yet.
   - Delete the generated `.dark` variable block. Keep the class-based dark variant
     so generated dark utilities remain inactive without a `.dark` ancestor. Retain
     supporting imports and base rules used by the generated components.
5. Check: `rtk pnpm check` passes and screenshots match Phase 0, including corner
   rounding. The expected difference is that `layout.tsx` utilities (`h-full`,
   `min-h-full flex flex-col`) now beat the legacy `body` rule; confirm the page height
   still fills the viewport.

## Phase 2 — Switch the look

One diff, confined to `legacy.css`, `globals.css`, and `layout.tsx`.

1. Repoint the legacy tokens at the shadcn variables:

   | Legacy token                     | Becomes                                                |
   | -------------------------------- | ------------------------------------------------------ |
   | `--scorecard`                    | `var(--background)`                                    |
   | `--ledger`, `--paper`, `--field` | `var(--card)`                                          |
   | `--inset`                        | `var(--muted)`                                         |
   | `--graphite`, `--ink`            | `var(--foreground)`                                    |
   | `--pencil`, `--quiet`            | `var(--muted-foreground)`                              |
   | `--bentgrass`                    | `var(--primary)`                                       |
   | `--bentgrass-hover`              | `color-mix(in oklab, var(--primary) 90%, transparent)` |
   | `--sand`, `--rule`               | `var(--border)`                                        |
   | `--rule-soft`                    | `color-mix(in oklab, var(--border) 50%, transparent)`  |
   | `--focus`                        | `var(--ring)`                                          |
   | `--flag`                         | `var(--destructive)`                                   |

2. Replace the single unlayered `--radius` value with the selected shadcn theme's
   radius, keeping one declaration.
3. Replace the 6 hard-coded `rgb()/rgba()` values with theme-based `color-mix()` values.
   Preserve the distinction between focus indicators and the account-menu shadow.
   Recolour the legacy native select's SVG arrow to the neutral theme.
4. Load Geist with `next/font` in `layout.tsx` using a distinct generated variable
   such as `--font-geist`. Map `--font-sans`, `--font-club`, and `--font-ledger` to it;
   remove the old `--font-sans: var(--font-club)` mapping to avoid a variable cycle.
   Set heading weight to 600, including explicit legacy heading rules.
5. Check text on primary backgrounds, links, selected rows, and badges. Check contrast
   for text, controls, and focus rings against WCAG 2.2 AA; adjust theme-based focus
   styling where the existing translucent ring no longer has enough contrast.
6. Check the scoreboard and pages with group branding images against the new background.
7. Capture the approved screenshots at all three widths as the reference for later phases.

## Phase 3 — Primitives and shared blocks

1. Add `button`, `input`, `label`, `textarea`, `native-select`, `checkbox`, `card`,
   `table`, `badge`, `alert`, `separator`, and `dropdown-menu` using the CLI version
   and style recorded in Phase 1.
2. Edit the copied `button`, `input`, and `native-select` so the default size is `h-11`.
   Do not apply text-input sizing to checkboxes or radios.
3. Rebuild the four exports of `src/components/blocks.tsx`, keeping their props unchanged:
   - `Field` → `Label` plus help and error text in utilities.
   - `SectionHeading`, `ActionRow` → utilities.
   - `EmptyState` → muted text block, retaining `role="status"`.
4. Add to `blocks.tsx`:
   - `FormMessage` (`Alert` with `tone: "error" | "success" | "info"`), preserving
     the existing message text and announcement behaviour at each call site.
   - `SkipLink`, retaining the text `Skip to main content` and `href="#main-content"`.
   - `PageHeader` and `DataTable` wrappers once two converted pages demonstrate what
     they share. Do not design them up front.

## Phase 4 — Sweep by element type (all pages)

Replace shared elements across the app, one PR per row, before touching page layouts.
Checkbox conversion includes behaviour changes to handlers and must not be treated as
a tag-only replacement.

| From                                                                                                | To                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary-button`, `secondary-button`, `danger-button`, `text-button`, `button-link`, `primary-link` | `Button` with `default` / `outline` / `destructive` / `link`; `asChild` for links; preserve explicit button types and link destinations                                                                       |
| `form-message`, `status-note`, `recovery-status`                                                    | `FormMessage`, preserving live-region roles and text                                                                                                                                                          |
| All inputs except hidden, radio, and checkbox inputs; `<textarea>`; `<select>`                      | `Input`, `Textarea`, `NativeSelect`; preserve refs, names, values, validation, and accessibility attributes                                                                                                   |
| Hidden inputs                                                                                       | Keep native and unchanged; exclude them from visual-control conversion counts                                                                                                                                 |
| Radio inputs                                                                                        | Keep native; replace legacy styling with utilities preserving compact sizing, labels, grouping, checked values, handlers, and keyboard operation                                                              |
| Checkboxes                                                                                          | `Checkbox`; convert controlled handlers to `onCheckedChange={(checked) => update(checked === true)}` and preserve `checked`, `defaultChecked`, `disabled`, `required`, `name`, `value`, and accessible labels |
| Skip-link anchors                                                                                   | `SkipLink`; update route checks and add a rendered-component assertion as described below                                                                                                                     |
| `<details>` menu in `portal/account-menu.tsx`                                                       | `DropdownMenu`; retain real links and the server-action sign-out form, then remove the replaced keyboard handlers                                                                                             |

Checks required by these replacements:

- Checkboxes: test a controlled toggle and verify that submission contains the same
  names and values. Current default values are `"on"`; account e-mail confirmation
  explicitly submits `"true"`. Test checked, unchecked, disabled, and reset behaviour.
  Preserve existing `noValidate` choices and server validation.
- Radios: verify quota method and decimal-place selection, arrow-key navigation, and
  the values consumed by the existing submit handler.
- Skip links: change route-source checks to count `<SkipLink />` calls while retaining
  the existing `main-content` ID and `tabIndex={-1}` checks for every render branch.
  Move the route-local text assertion into a rendered `SkipLink` test that verifies
  the actual anchor text and `href`. Keep the browser focus/activation check.
- Account menu: verify Enter/Space opening, arrow-key item movement, Escape closing
  and trigger-focus restoration, outside-click closing, link navigation, and sign-out
  submission. Preserve `Link` and `form action={signOutAction}` instead of replacing
  navigation or sign-out with new client callbacks.

After each PR, delete only rules with no remaining callers. Include all 14
`primary-link` usages in the button PR before deleting declarations shared with
`.primary-button`; retain any page-specific spacing until its replacement is present.
Remove the legacy select's background image when `NativeSelect` supplies its own icon.
Delete global visual-control rules only once every visible control has its replacement
styling. Native hidden inputs do not block this deletion; native radios need their
utility styling first. Update checkbox-label selectors that relied on a direct native
input child.

## Phase 5 — Pages, one area per PR

For each area: replace page-prefixed classes with utilities and components, then delete
that area's unused legacy rules in the same PR. Compare against the Phase 2 screenshots
at all three widths.

Order, smallest and most self-contained first:

1. Sign-in, sign-up, recover-password, reset-password, invitation acceptance (162).
2. Account, home, and information pages: privacy, terms, support, help, feedback.
3. Member pages (226): home, results, standings, inbox, profile, directory, first-run,
   and round detail, including loading and error branches.
4. Portal shell, navigation, and dashboard (90, including `quota-settings-form.tsx`).
5. `portal/rounds` (197).
6. `portal/members` (211). `member-management.tsx` is 1,661 lines; split the PR per file.
7. Remaining portal sections: group, standings, invitations, branding, billing, reports,
   content, quota (163).
8. Scoreboard. Check it at kiosk size as well.

Rules while converting:

- Layout that appears once goes inline as utilities.
- Reuse components where pages share behaviour and structure; usage count alone does
  not require a new wrapper.
- Convert the responsive media queries into utility prefixes, retaining their current
  breakpoints. Keep `prefers-reduced-motion` behaviour.
- Tables that turn into cards on narrow screens (`member-roster-table` /
  `member-roster-cards`) keep that behaviour.

## Phase 6 — Clean-up and guard rails

1. Delete `legacy.css`, its import, and the legacy token aliases. Retain the Tailwind
   import, generated supporting stylesheet imports, shadcn theme variables,
   `@theme inline`, the class-based dark variant, and generated `@layer base` rules.
   The body must still receive
   `bg-background` / `text-foreground`, and base border / outline styling must remain.
   Keep the Geist mapping and the single shadcn `--radius` declaration.
2. Rewrite the "UI building blocks" section of `apps/web/AGENTS.md`: build from
   `src/components/ui/` and `src/components/blocks.tsx`; add primitives with the recorded
   shadcn CLI version and style; no new CSS files or page class selectors. Allow the
   required theme imports, variables, and base element rules in `globals.css`.
3. Add `tests/web-styling-guard.test.ts`: fail if `apps/web/src` contains a CSS file
   other than `globals.css`, or if `globals.css` contains a class-selector rule. Inspect
   rule selectors, not text inside at-rules such as the dark variant. Allow supporting
   imports and base element rules; supporting dependency styles live outside
   `apps/web/src`.
4. Update `docs/tech-stack.md` to name Tailwind and shadcn/ui.
5. Compare screenshots again after deleting legacy CSS, and recheck the menu, native
   radios, focus rings, and reduced-motion behaviour.

## Phase 7 — E-mails

1. Add `apps/web/src/emails/theme.ts` with the palette as hex constants; e-mail clients
   do not reliably support CSS variables or `oklch()`.
2. Point the 7 templates in `apps/web/src/emails/` at it and remove their inline hex values.
3. Render each template through the installed React Email preview and check light-mode
   appearance, links, and unchanged copy.

## Check for every PR

- `rtk pnpm check` (format, lint, typecheck, test, build).
- Screenshots at 1280x720, 768x900, and 375x812 for the routes touched.
- Keyboard pass: tab order, visible focus, skip-link activation, and any changed control
  or menu interaction.
- For primitive replacements, verify the existing form action receives the same values
  and that pending, disabled, error, and success branches still work.
- Review changed user-facing strings separately; this migration must preserve them.
- `legacy.css` line count went down, or the PR says why not.

## Risks

| Risk                                                          | Mitigation                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Layout drift without visual regression tests                  | Baseline and approved Phase 2 screenshots; one area per PR                                              |
| Legacy rules competing with primitives                        | `components` layer; remove unused rules and inherited select icons in the same PR                       |
| Shared tokens changing the foundation appearance              | Keep the original unlayered radius and font mapping through Phase 1                                     |
| Near-black primary colour weakening accents or focus contrast | Phase 2 contrast review before structural work                                                          |
| Form behaviour changing                                       | Explicit checkbox handler conversion, native radio/hidden exceptions, and interaction/submission checks |
| Account menu losing navigation or sign-out behaviour          | Preserve links and server-action forms; verify menu keyboard and focus behaviour                        |
| Cleanup removing required shadcn styles                       | Retain supporting imports and base rules; repeat screenshots and interaction checks                     |
| Long-lived branch conflicts                                   | Phases 1–2 are two small PRs; Phases 4–5 land separately on `main`                                      |
| `member-management.tsx` at 1,661 lines                        | One file per PR in Phase 5                                                                              |

References: [shadcn theming](https://ui.shadcn.com/docs/theming),
[Radix checkbox usage](https://ui.shadcn.com/docs/components/radix/checkbox).
