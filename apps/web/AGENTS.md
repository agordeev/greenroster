<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UI building blocks

- Build pages from `src/components/ui.tsx` (`Field`, `SectionHeading`, `EmptyState`, `ActionRow`) instead of writing those class names by hand.
- Inputs, selects, textareas, checkboxes and buttons are styled once at the top of `src/app/globals.css`. Do not restyle them per page; use `--control`, `--radius` and the colour tokens.
- Portal pages follow list → detail: a list page links to a separate page (or `?id=` view) for creating and editing. Do not stack a create form above a list.
- New portal sections go into `primaryNav` / `secondaryNav` in `src/app/portal/portal-shell.tsx`.
- `tests/user-facing-copy.test.ts` fails when on-screen text uses words banned by the root `AGENTS.md`.
