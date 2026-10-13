<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UI building blocks

- Build pages from the primitives in `src/components/ui/` (`Button`, `Input`, `Textarea`, `NativeSelect`, `Checkbox`, `Label`, `Card`, `Table`, `Badge`, `Alert`, `Separator`, `DropdownMenu`) and the shared blocks in `src/components/blocks.tsx` (`Field`, `FieldHelp`, `FieldError`, `SectionHeading`, `Kicker`, `EmptyState`, `ActionRow`, `FormMessage`, `TextLink`, `SkipLink`), plus Tailwind utilities.
- Colours, fonts, radius and motion follow `.interface-design/system.md` (the scorecard look). Use the theme tokens; do not hard-code colours or add a second accent.
- Add primitives with `pnpm dlx shadcn@4.21.4 add <name>` from `apps/web`. `components.json` records the style (`radix-nova`, neutral base colour, Radix primitives); keep that version and style so new primitives match.
- Buttons, text inputs and native selects are 44px tall by default (`h-11`). Do not shrink them on member pages.
- Selects, date inputs, radios and hidden inputs stay native. Checkboxes use `Checkbox` with `onCheckedChange`.
- No new CSS files and no class selectors in `src/app/globals.css`. It holds only the Tailwind and shadcn imports, the theme variables, `@theme inline`, the class-based dark variant, and base element rules. `tests/web-styling-guard.test.ts` enforces this.
- Portal pages follow list → detail: a list page links to a separate page (or `?id=` view) for creating and editing. Do not stack a create form above a list.
- New portal sections go into `primaryNav` / `secondaryNav` in `src/app/portal/portal-shell.tsx`.
- `tests/user-facing-copy.test.ts` fails when on-screen text uses words banned by the root `AGENTS.md`.
