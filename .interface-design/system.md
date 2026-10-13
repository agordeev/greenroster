# GreenRoster interface system

Applies to `apps/web`. Read with `apps/web/AGENTS.md` (primitives, 44px
controls, no new CSS) and the root `AGENTS.md` (copy rules).

## Direction: the scorecard

GreenRoster looks like the card in a golfer's back pocket: cream card stock,
fairway-green ink, ruled hairlines, figures set in a typewriter face, and one
pin-flag yellow mark. The organizer opens the portal to see what needs a look
before the next round, so pages stay calm and scannable: numbers and names
lead, labels stay quiet.

Everything is driven by the tokens in `src/app/globals.css`. Change a token,
not a page.

## Colour

| Token                | Role                                                     |
| -------------------- | -------------------------------------------------------- |
| `background`         | Paper. The canvas, with a faint grain on `body`.         |
| `card`               | Card stock. Cards, panels, inputs, outline buttons.      |
| `foreground`         | Ink. Green-black, for text.                              |
| `primary`            | Fairway green. Primary buttons, links, the brand mark.   |
| `muted`, `secondary` | Tinted paper. Hover, info messages, the footer band.     |
| `muted-foreground`   | Labels and notes. Keeps 4.5:1 on `muted`.                |
| `border`, `input`    | Hairlines. `input` keeps 3:1 on card, for control edges. |
| `flag`               | Pin-flag yellow. The only accent.                        |
| `destructive`        | Errors and destructive actions only.                     |

`flag` marks **where you are and what is done**: the tick before a kicker, the
underline under the current nav item, filled progress segments, the dot on the
brand mark, text selection. It is never a text colour on paper (it fails
contrast) and never a button fill. On `bg-primary` it may be used for small
labels.

Green is the dominant colour, used in large fields (the sign-in side panel)
and small strokes (the 3px rule on top of a page panel). Do not add a second
hue.

## Type

Loaded in `src/app/layout.tsx`.

- **Besley** (`font-heading`): `h1`, `h2`, `CardTitle`, the wordmark. Always
  weight 600. Set in the base layer for `h1` and `h2`, so pages need no class.
- **Instrument Sans** (`font-sans`): everything you read. Body, labels,
  buttons, `h3` and below.
- **DM Mono** (`font-mono`): figures and small uppercase labels. Stat values,
  kickers, badges. Weight 500.

Page title via `PageHeader`. Card titles are `CardTitle` wrapping a real
`<h2>`. Numbers: `font-mono text-3xl font-medium tabular-nums leading-none`.
Names as headlines: `text-xl font-semibold` in Besley. Labels
`text-sm text-muted-foreground`; notes `text-xs text-muted-foreground`. Tables
use tabular figures by default.

The kicker (`Kicker`) is mono, 11px, uppercase, tracked `0.16em`, with the
yellow tick. It belongs to the page header and section headings only; no kicker
above card titles.

## Shape and depth

Radius is `0.3125rem`: crisp, like cut card. Pills are for the account menu
only. Badges are small squared mono labels, not pills.

Rings and hairlines, no drop shadows. Cards use `ring-1 ring-foreground/10`.
The primary button has an inset bottom edge so it reads as pressed ink, not a
floating chip. Never put a card inside a card; split one card with hairlines.

A page panel (`PagePanel`, the information page `main`) carries a 3px
`border-t-primary` rule: the top edge of the scorecard.

Surface tint (`bg-muted`, `bg-secondary`) is reserved for things that are not
page content: the footer band, hover states, info messages, empty states.

## Motion

One entrance per page: the panel or dashboard fades and rises 8px over 500ms
(`animate-in fade-in slide-in-from-bottom-2 duration-500`). The nav underline
grows from the left on hover. Nothing else moves. Reduced motion turns all of
it off in the base layer.

## Spacing

4px base (Tailwind scale). `gap-4` between cards, `p-4` inside cards and stat
cells, `mt-8` from page header to content, `mt-12` before the footer. Page
width `max-w-288`.

## Patterns

### Brand mark (`BrandMark` in `components/blocks.tsx`)

Green tee-marker square, "GR" in Besley, yellow dot top right. Always paired
with the wordmark in `font-heading`. Do not redraw it inline.

A `BrandLockup` adds the wordmark and tagline; it opens every sign-in page.

### Sign-up, recovery and invitation pages (`AuthPanel`)

One centred panel, `max-w-152`, with the ring and the 3px green rule, the
`BrandLockup`, then kicker, title and form. On phones it fills the screen from
the top edge and the submit button spans the width. It brings its own
`SkipLink` and `main`.

### Help and legal text (`Prose`)

Reading text is `text-foreground/85`, not the label colour. Lists are ruled
rows (a hairline above each item), not bullets. Links inside a paragraph are
green, semibold and underlined. A version or date line is
`font-mono text-[0.6875rem] text-muted-foreground`.

Information pages (`information-shell.tsx`) put the header on the canvas as a
plain row, so the green-ruled panel is the only card; the footer sits at the
bottom of the screen on short pages.

### Portal nav (`portal/portal-shell.tsx`)

Ghost buttons with no hover fill. The current item is ink with a 2px yellow
underline; other items show the underline on hover. Section tabs under the
header use a green bottom border for the current tab.

### Messages (`FormMessage`)

A 3px left rule carries the tone: red for errors, green for success, grey for
info. The fill is a light tint of the same tone.

### Empty state (`EmptyState`)

Dashed `border-input` on tinted paper: a blank line on the card, waiting to be
filled in.

### Dashboard page (portal home)

Content sits on the canvas, not in `PagePanel`:
`mx-auto mt-10 max-w-288 max-[480px]:mt-6 max-[480px]:px-4`, then
`grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]`. Main column holds
data cards; the side column holds one task card, `lg:sticky lg:top-6`. DOM order
is main then side, so phones show data first.

List and detail pages keep `PagePanel`. A page that writes its own `<section>`
uses `portalPanelClass` instead; it is the same panel and also sets the title,
the ruled `h2` sections and the lead paragraph.

### Member and account pages (`standalonePageClass`, `standalonePanelClass`)

Pages with no portal header sit in one centred, green-ruled panel, like
`AuthPanel`. `standalonePageClass` goes on `main` (38rem panel),
`standalonePageWideClass` for lists (52rem), and `standalonePanelFullClass` on
the `section` for tables (72rem). Do not copy the class strings into a page.

### Detail pages

The page title is the thing itself (the member's name, "New round"), with a
"← All …" link above it and no kicker. A detail page with several jobs splits
them into tabs under the title (`?tab=`), one form per tab, never a stack of
forms. Sections a person rarely fills in are closed `<details>` rows.

### List pages

One toolbar row above the table: search, then selects that apply on change.
Sort from the column headings. Count, page size and paging sit under the table.
An empty cell is a muted dash.

### Boxes inside a panel

A group of content inside a panel is a hairline box on card stock:
`rounded-lg border`, no fill. Its small uppercase labels are mono.

### Stat strip (`StatStrip` + `Stat` in `portal/portal-dashboard.tsx`)

Several numbers on one card. `Card className="gap-0 py-0"`, header
`border-b pt-4`, then `grid gap-px bg-border` with `bg-card p-4` cells, so the
hairlines work at any column count. Values are mono. A zero value is
`text-muted-foreground` so the numbers that need a look stand out. A cell with
`href` is a link for the whole cell.

A related link row can close the card: `border-t px-4 py-3`, text left, count
and `ChevronRightIcon` right.

### Headline card (`HeadlineCard`)

Leads with a name, not a number. Label (`CardDescription`), headline
(`CardTitle text-xl`), chevron in `CardAction`, then one medium-weight detail
line and one `text-xs` muted note. The whole card is a link; hover is
`bg-muted/50`.

### Links inside a card

Cards clip overflow, so focus rings go inward:
`outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring`.

### Segmented progress (setup checklist)

One segment per task: `h-1.5 flex-1 rounded-full`, `bg-flag` when done,
`bg-foreground/10` otherwise, `aria-hidden`, next to a text count. Status in the
list is an icon plus `sr-only` text, not a badge.

### Sign-in side panel (`sign-in/page.tsx`)

The one large green field. `bg-primary text-primary-foreground`, ruled into
nine faint columns like a scorecard, yellow bar top left, Besley headline, and
a three-column `dl` with yellow mono terms.

### Footer (`app/information-footer.tsx`)

Tinted band, set apart from the page: `mt-12 rounded-xl bg-secondary px-6 py-3`,
edge to edge with a top border under 480px. Help links on the left, legal links
on the right, centered when they wrap. Links are muted, `py-2` for touch, and
turn `text-foreground` with an underline on hover.
