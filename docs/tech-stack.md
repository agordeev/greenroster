# Tech Stack

## Selected stack

- **Mobile:** React Native, Expo, TypeScript
- **Web and API:** Next.js, React, TypeScript
- **Database, authentication, realtime, and file storage:** Supabase
- **Billing:** Stripe
- **Push notifications:** Expo Notifications
- **Email:** Resend
- **Hosting:** Vercel and Supabase

Expo Notifications and Resend are v1 implementation requirements, used for the transactional push and e-mail defined in Section 12 of `master-spec.md`. Stripe is a reserved technology for the deferred billing capability described in `future-scope.md` and is not built in v1. V1 has no SMS provider or SMS delivery capability.

## Architecture

GreenRoster has one application environment and one hosted Supabase project. Local Docker is the development runtime, not a separately managed environment. Keep business rules in Next.js server code and PostgreSQL as the source of truth.

Do not introduce a separate backend, microservices, Kubernetes, Redis, or a message broker until demonstrated needs justify them.
