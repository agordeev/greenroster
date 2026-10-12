# GreenRoster

GreenRoster is a cross-platform golf points-game service. This repository contains one Next.js web and API application and a Supabase-backed PostgreSQL data layer.

## Architecture boundary

GreenRoster has one application environment backed by one hosted Supabase project. The Supabase CLI stack runs in local Docker only for development and automated tests; it is not a second managed environment and must use synthetic data rather than hosted user data or credentials.

## Prerequisites

- Node.js 24.3.0 (see `.nvmrc`)
- pnpm 10.6.3
- Docker Desktop or another Docker-compatible runtime

## Clean-checkout setup

1. Install JavaScript dependencies with `pnpm install --frozen-lockfile`.
2. Start Docker, then run `pnpm db:start`.
3. Copy `apps/web/.env.example` to `apps/web/.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` to the local `API_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the local `ANON_KEY`, and `SUPABASE_SECRET_KEY` to the local `SERVICE_ROLE_KEY` printed by `pnpm db:status`; the current local PostgREST stack expects JWT keys for these clients. Replace every other `replace-with-...` value; startup rejects copied placeholders.
4. Run `pnpm db:local-legal` when you want to exercise organizer signup locally. This writes the checked-in legal document versions to the local database; it does not publish hosted legal documents.
5. Run `pnpm dev:web` for the web app.

The local Supabase status output provides the local API URL plus JWT keys for the example environment files. Never copy hosted secrets or production user data into this workspace.

## Shared commands

| Command          | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm format`    | Check repository formatting                                          |
| `pnpm lint`      | Lint all applications                                                |
| `pnpm typecheck` | Type-check all applications                                          |
| `pnpm test`      | Run focused tests in every package that defines them                 |
| `pnpm build`     | Produce the web build                                                |
| `pnpm check`     | Run formatting, linting, type checks, unit tests, and app builds     |
| `pnpm db:start`  | Start the local Supabase Docker stack and apply migrations           |
| `pnpm db:status` | Print local API, JWT, Studio, and mail-catcher connection details    |
| `pnpm db:reset`  | Rebuild the local database and apply the phase-appropriate seed file |
| `pnpm db:test`   | Run the pgTAP database contract suite against local Supabase         |

Product requirements live in [`docs/master-spec.md`](./docs/master-spec.md).
