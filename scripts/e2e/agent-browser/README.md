# Local agent-browser lanes

These scripts exercise the local Next.js app through real browser sessions. Use
`127.0.0.1` so server actions and Supabase redirect URLs use the same origin.

Prerequisites:

- local Supabase is running;
- the web dev server is running on port `3000`;
- `agent-browser` is installed;
- local legal/runtime configuration is present.

Run the signed-out route lane:

```bash
BASE_URL=http://127.0.0.1:3000 \
RUN_ID=public-$(date -u +%Y%m%dT%H%M%SZ) \
rtk scripts/e2e/agent-browser/public-smoke.sh
```

Run the organizer lane. It creates a unique disposable account and group through
the actual signup flow; it does not use a pre-seeded browser session:

```bash
E2E_PASSWORD="$LOCAL_E2E_PASSWORD" \
BASE_URL=http://127.0.0.1:3000 \
RUN_ID=organizer-$(date -u +%Y%m%dT%H%M%SZ) \
rtk scripts/e2e/agent-browser/organizer-smoke.sh
```

`E2E_PASSWORD` must be at least 8 characters and should be supplied through the
shell environment or CI secret store. Do not commit it or print it in logs.

Each run writes mode-restricted snapshots, screenshots, console/errors, and
request-list evidence under `artifacts/<RUN_ID>`. The directory is ignored by
Git. HAR capture is intentionally not automatic because Auth and results-link
flows can contain bearer-equivalent values; sanitize any high-risk HAR before
retaining it.

The lanes cover local smoke behavior only. Two-group fixtures, invitations and
product notification delivery, round lifecycle states, native scoring/offline
queue, hosted providers, and the failing administrator clubhouse/branding routes
remain tracked in `docs/e2e-agent-browser-plan.md`.
