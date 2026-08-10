# Tech Stack

## Selected stack

- **Mobile:** React Native, Expo, TypeScript
- **Web and API:** Next.js, React, TypeScript
- **Database, authentication, realtime, and file storage:** Supabase
- **Billing:** Stripe
- **Push notifications:** Expo Notifications
- **Email:** Resend
- **Hosting:** Vercel and Supabase

Expo Notifications and Resend are implementation requirements, used for the transactional push and e-mail defined in Section 12 of master-spec.md. Stripe is now wired for the approved parity billing slice: server-only checkout/customer-portal calls, webhook verification, ordered reconciliation, and entitlement projection. Production use still requires the configured Stripe product, price, webhook secret, and hosted migration evidence. GreenRoster has no SMS provider or SMS delivery capability.

The August 10, 2026 parity expansion also includes Supabase-backed clubhouse content, round messaging, branding assets, token-scoped scoreboard branding, hole-level scorecards, personal golf statistics, and authenticated CSV/PDF reports. Advanced game formats, GHIN, multi-group identity, and legacy cutover remain blocked until their executable rules or external inputs are approved.

## Architecture

GreenRoster has one application environment and one hosted Supabase project. Local Docker is the development runtime, not a separately managed environment. Keep business rules in Next.js server code and PostgreSQL as the source of truth.

Do not introduce a separate backend, microservices, Kubernetes, Redis, or a message broker until demonstrated needs justify them.
