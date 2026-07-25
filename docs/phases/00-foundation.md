# Phase 00 — Foundation

## Goal

Create the smallest reliable workspace in which the web app, mobile app, database, and automated checks can evolve together.

## Deliverables

- Initialize the Git repository with a concise root README and development instructions.
- Scaffold one Next.js application and one React Native/Expo application using TypeScript.
- Add Supabase local-development configuration and a migrations directory.
- Fix the data conventions the whole schema depends on in the first migration: exact numeric types for quota, points, handicap, merit, and adjustments, UTC timestamps, immutable identifiers, and unique constraints for idempotency keys. Retrofitting these later invalidates stored calculations.
- Establish runtime configuration with checked-in examples, startup validation, and no committed secrets.
- Add shared commands for formatting, linting, type-checking, focused tests, and production builds.
- Add a synthetic local dataset and the fixture approach later phases extend, so local development never needs hosted user data.
- Add CI that installs dependencies and runs the same checks from a clean checkout.
- Verify that the web app and both mobile targets can start against the local Docker runtime.

Do not create speculative services, queues, packages, or abstractions. Add shared code only when the first real vertical slice needs it.

## Exit criteria

- A new developer can follow the README from a clean checkout and start the development stack.
- CI passes formatting, linting, type-checking, tests, and builds.
- Missing required configuration fails fast with a clear error.
- The single-environment rule and the boundary between the hosted project and local Docker runtime are documented.
- A rounding and precision unit test proves the numeric column types behave exactly, with no floating-point drift.

## Master-spec coverage

- Section 3 — Technology and architecture
- Section 3.1 — Single environment
- Section 13.5 — Data rules
- Section 17.3 — Time, locale, and numbers
- Section 18.1 — Automated testing
