import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { signInPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { buildOnboardingChecklist } from "@/lib/groups/onboarding-checklist";
import type { PortalDashboardSummary } from "@/domain/portal-dashboard";
import { executePortalDashboardData } from "@/lib/portal/dashboard-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { GroupBootstrapForm } from "./group-bootstrap-form";
import { OnboardingChecklist } from "./onboarding-checklist";
import { PortalShell } from "./portal-shell";
import {
  QuotaSettingsForm,
  type QuotaSettingsFormValue,
} from "./quota-settings-form";

const contextSchema = z
  .array(
    z.object({
      membership_id: z.uuid(),
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
    }),
  )
  .max(1);

const onboardingSchema = z
  .array(
    z.object({
      additional_membership_count: z.number().int().nonnegative(),
      group_profile_complete: z.boolean(),
      quota_rules_configured: z.boolean(),
    }),
  )
  .max(1);

const quotaSettingsSchema = z.object({
  method: z.enum(["moving_average", "best_10_of_20", "previous_plus_minus"]),
  moving_average_history_length: z.number().int().min(4).max(20).nullable(),
  participation_merit: z.union([z.string(), z.number()]),
  precision: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  standings_reset_date: z.string().nullable(),
  version: z.number().int().positive(),
});

const quotaBandsSchema = z.array(
  z.object({
    adjustment: z.union([z.string(), z.number()]),
    lower_bound: z.union([z.string(), z.number()]),
    lower_inclusive: z.boolean(),
    upper_bound: z.union([z.string(), z.number()]),
    upper_inclusive: z.boolean(),
  }),
);

const placementMeritRowsSchema = z.array(
  z.object({
    merit_points: z.union([z.string(), z.number()]),
    rank: z.number().int().positive(),
  }),
);

export default async function PortalPage() {
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return (
      <PortalState
        kicker="Protected portal"
        title="Your session could not be checked"
        message="The authentication service is temporarily unavailable. Try again in a moment."
      />
    );
  }

  const { data: userData, error: userError } = userResult;
  if (userError && isAuthRetryableFetchError(userError)) {
    return (
      <PortalState
        kicker="Protected portal"
        title="Your session could not be checked"
        message="The authentication service is temporarily unavailable. Try again in a moment."
      />
    );
  }
  if (userError || !userData.user) redirect(signInPath("/portal"));

  if (!userData.user.email_confirmed_at) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Account verification"
        title="Verify your account e-mail"
        message="This identity cannot access or create a group until its account e-mail is verified."
      />
    );
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== userData.user.id) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Protected portal"
        title="Your session could not be checked"
        message="The authentication service is temporarily unavailable. Try again in a moment."
      />
    );
  }

  const recoveryState = await resolvePasswordRecoveryState(
    claims.session_id,
    claims.sub,
  );
  if (recoveryState === "active") redirect("/reset-password");
  if (recoveryState === "unavailable") {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Protected portal"
        title="Your session could not be checked"
        message="The authentication service is temporarily unavailable. Try again in a moment."
      />
    );
  }
  if (
    recoveryState === "expired" ||
    recoveryState === "consumed" ||
    recoveryState === "claimed"
  ) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Recovery session expired"
        title="Request a new password recovery link"
        message="This recovery session cannot open the portal. Sign out, then request a new link if you still need to change your password."
      />
    );
  }

  const contextResult = await supabase.rpc("resolve_identity_context");
  const parsedContext = contextSchema.safeParse(contextResult.data);
  const context = parsedContext.success ? parsedContext.data[0] : undefined;

  if (contextResult.error || !parsedContext.success) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Protected portal"
        title="Your group access could not be checked"
        message="The service is temporarily unavailable. Sign out and try again."
      />
    );
  }

  if (!context) {
    const affiliation = await resolveIdentityAffiliation(userData.user.id);

    if (!affiliation.ok) {
      return (
        <PortalState
          email={userData.user.email}
          kicker="Protected portal"
          title="Your group access could not be checked"
          message="The service is temporarily unavailable. Sign out and try again."
        />
      );
    }

    if (affiliation.state !== "unattached") {
      return (
        <PortalState
          email={userData.user.email}
          kicker="Access unavailable"
          title="Your group access is not active"
          message="You are signed in, but this identity does not have an active group membership. Ask a group administrator to review your access."
        />
      );
    }

    return (
      <PortalShell
        email={userData.user.email ?? "Verified account"}
        groupName="Group not created"
        roleStatus="Access not created"
        timeZone="Choose during setup"
      >
        <section className="portal-ledger">
          <p className="ledger-kicker">Administrator first run</p>
          <h1>Set up your group</h1>
          <p>
            Your verified account is ready. Group identity and your
            person-specific administrator access are created together.
          </p>
          <GroupBootstrapForm identityKey={userData.user.id} />
        </section>
      </PortalShell>
    );
  }

  const groupResult = await supabase
    .from("groups")
    .select("name,time_zone")
    .eq("id", context.group_id)
    .single();

  if (groupResult.error || !groupResult.data) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Protected portal"
        title="Your group could not be loaded"
        message="The service is temporarily unavailable. Sign out and try again."
      />
    );
  }

  const groupName =
    typeof groupResult.data?.name === "string"
      ? groupResult.data.name
      : "GreenRoster group";
  const timeZone =
    typeof groupResult.data?.time_zone === "string"
      ? groupResult.data.time_zone
      : "";

  if (context.role === "member") {
    return (
      <PortalShell
        email={userData.user.email ?? "Signed-in account"}
        groupName={groupName}
        role={context.role}
        timeZone={timeZone}
      >
        <section className="portal-ledger role-denied">
          <p className="ledger-kicker">Role denied</p>
          <h1>Portal access is not available for this role</h1>
          <p>
            You are signed in, but the administrative portal requires a
            coordinator or administrator role.
          </p>
          <div className="information-actions">
            <Link className="primary-link" href="/home">
              Home
            </Link>
            <Link className="secondary-link" href="/support">
              Contact support
            </Link>
          </div>
        </section>
      </PortalShell>
    );
  }

  const onboardingResult = await supabase.rpc("resolve_group_onboarding");
  const parsedOnboarding = onboardingSchema.safeParse(onboardingResult.data);
  const onboarding = parsedOnboarding.success
    ? parsedOnboarding.data[0]
    : undefined;

  if (onboardingResult.error || !onboarding) {
    return (
      <PortalShell
        email={userData.user.email ?? "Signed-in account"}
        groupName={groupName}
        role={context.role}
        timeZone={timeZone}
      >
        <section className="portal-ledger">
          <p className="ledger-kicker">Group onboarding</p>
          <h1>Setup status could not be loaded</h1>
          <p>
            The stored onboarding facts are temporarily unavailable. Refresh
            before continuing group setup.
          </p>
        </section>
      </PortalShell>
    );
  }

  const checklist = buildOnboardingChecklist(
    onboarding.group_profile_complete,
    onboarding.quota_rules_configured,
    onboarding.additional_membership_count,
  );

  let quotaSettings: QuotaSettingsFormValue | null = null;
  let quotaSettingsUnavailable = false;

  if (context.role === "administrator") {
    const [settingsResult, bandsResult, placementResult] = await Promise.all([
      supabase
        .from("group_quota_settings")
        .select(
          "method,moving_average_history_length,precision,version,participation_merit,standings_reset_date",
        )
        .eq("group_id", context.group_id)
        .maybeSingle(),
      supabase
        .from("quota_adjustment_bands")
        .select(
          "lower_bound,lower_inclusive,upper_bound,upper_inclusive,adjustment",
        )
        .eq("group_id", context.group_id)
        .order("position"),
      supabase
        .from("placement_merit_rows")
        .select("rank,merit_points")
        .eq("group_id", context.group_id)
        .order("rank"),
    ]);
    const parsedSettings = quotaSettingsSchema
      .nullable()
      .safeParse(settingsResult.data);
    const parsedBands = quotaBandsSchema.safeParse(bandsResult.data);
    const parsedPlacement = placementMeritRowsSchema.safeParse(
      placementResult.data,
    );

    quotaSettingsUnavailable = Boolean(
      settingsResult.error ||
      bandsResult.error ||
      placementResult.error ||
      !parsedSettings.success ||
      !parsedBands.success ||
      !parsedPlacement.success,
    );

    if (!quotaSettingsUnavailable && parsedSettings.data) {
      quotaSettings = {
        bands: parsedBands.success
          ? parsedBands.data.map((band) => ({
              adjustment: String(band.adjustment),
              lowerBound: String(band.lower_bound),
              lowerInclusive: band.lower_inclusive,
              upperBound: String(band.upper_bound),
              upperInclusive: band.upper_inclusive,
            }))
          : [],
        historyLength: parsedSettings.data.moving_average_history_length,
        method: parsedSettings.data.method,
        precision: parsedSettings.data.precision,
        participationMerit: String(parsedSettings.data.participation_merit),
        placementMerit: parsedPlacement.success
          ? parsedPlacement.data.map((placement) => ({
              rank: placement.rank,
              points: String(placement.merit_points),
            }))
          : [],
        standingsResetDate: parsedSettings.data.standings_reset_date,
        version: parsedSettings.data.version,
      };
    }
  }

  let dashboardSummary: PortalDashboardSummary | null = null;
  let dashboardUnavailable = false;
  try {
    dashboardSummary = await executePortalDashboardData(userData.user.id);
  } catch {
    dashboardUnavailable = true;
  }

  return (
    <PortalShell
      email={userData.user.email ?? "Signed-in account"}
      groupName={groupName}
      role={context.role}
      timeZone={timeZone}
    >
      <section className="portal-ledger">
        <p className="ledger-kicker">Clubhouse operations</p>
        <h1>Welcome to your group</h1>
        <p>
          The portal shell is authorized from your current stored membership.
          Group setup status follows stored configuration as each operational
          area is enabled.
        </p>
        <PortalDashboardSummaryCard
          summary={dashboardSummary}
          unavailable={dashboardUnavailable}
        />
        <OnboardingChecklist items={checklist} />
        {context.role === "administrator" ? (
          <section
            className="quota-settings"
            aria-labelledby="quota-settings-title"
          >
            <div className="quota-settings-heading">
              <p className="ledger-kicker">Quota policy</p>
              <h2 id="quota-settings-title">Set the calculation rules</h2>
              <p>
                Quota and merit rules apply to rounds published after this save;
                published rounds keep their own snapshots. The standings reset
                date changes the current standings window immediately, without
                rewriting results or quota history.
              </p>
            </div>
            {quotaSettingsUnavailable ? (
              <div className="quota-settings-error">
                <p className="form-message" data-status="error">
                  Quota settings could not be loaded. Refresh before making a
                  change.
                </p>
                <Link className="secondary-link" href="/portal">
                  Reload quota settings
                </Link>
              </div>
            ) : (
              <QuotaSettingsForm
                key={quotaSettings?.version ?? 0}
                identityKey={context.group_id}
                initialValue={quotaSettings}
              />
            )}
          </section>
        ) : null}
      </section>
    </PortalShell>
  );
}

function PortalDashboardSummaryCard({
  summary,
  unavailable,
}: Readonly<{
  summary: PortalDashboardSummary | null;
  unavailable: boolean;
}>) {
  return (
    <section
      className="dashboard-summary"
      aria-labelledby="dashboard-summary-title"
    >
      <div className="dashboard-summary-heading">
        <div>
          <p className="ledger-kicker">Operational snapshot</p>
          <h2 id="dashboard-summary-title">Roster, results, and standings</h2>
        </div>
        <p>Authoritative counts from your current group</p>
      </div>
      {unavailable ? (
        <p className="dashboard-summary-unavailable" data-status="error">
          The roster and invitation summary could not be loaded. Onboarding and
          quota settings remain available; refresh to try again.
        </p>
      ) : summary ? (
        <>
          <div className="dashboard-summary-grid">
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=pending"
              aria-label={`Review ${summary.membershipCounts.pending} pending memberships`}
            >
              <span>Pending memberships</span>
              <strong>{summary.membershipCounts.pending}</strong>
              <small>Review roster</small>
            </Link>
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=active"
              aria-label={`Review ${summary.membershipCounts.active} active memberships`}
            >
              <span>Active memberships</span>
              <strong>{summary.membershipCounts.active}</strong>
              <small>Review roster</small>
            </Link>
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=inactive"
              aria-label={`Review ${summary.membershipCounts.inactive} inactive memberships`}
            >
              <span>Inactive memberships</span>
              <strong>{summary.membershipCounts.inactive}</strong>
              <small>Review roster</small>
            </Link>
          </div>
          <Link
            className={`dashboard-action-summary${
              summary.actionRequiredInvitations.total === 0
                ? " dashboard-action-summary--clear"
                : ""
            }`}
            href="/portal/invitations?delivery=action-required"
            aria-label={`Review ${summary.actionRequiredInvitations.total} invitation delivery issues`}
          >
            <span>
              <strong>
                {summary.actionRequiredInvitations.total === 0
                  ? "Invitation delivery health"
                  : "Invitation delivery attention"}
              </strong>
              <small>
                {summary.actionRequiredInvitations.total === 0
                  ? "No failed or suppressed invitations"
                  : formatActionRequiredInvitationSummary(
                      summary.actionRequiredInvitations,
                    )}
              </small>
            </span>
            <strong>{summary.actionRequiredInvitations.total}</strong>
          </Link>
          {summary.completedResult !== undefined || summary.standingsSummary ? (
            <div className="dashboard-summary-grid">
              <Link
                className="dashboard-summary-card"
                href={
                  summary.completedResult
                    ? `/portal/rounds?round=${encodeURIComponent(summary.completedResult.roundId)}`
                    : "/portal/rounds"
                }
                aria-label="Open recent official round results"
              >
                <span>Most recent completed result</span>
                <strong>
                  {summary.completedResult
                    ? summary.completedResult.description || "Completed round"
                    : "No completed rounds"}
                </strong>
                <small>
                  {summary.completedResult
                    ? `${summary.completedResult.winnerNames.length > 0 ? summary.completedResult.winnerNames.join(" · ") : "No ranked winner"} · ${summary.completedResult.resultCount} official rows · ${formatDashboardDate(summary.completedResult.completedAt, summary.completedResult.groupTimeZone)}`
                    : "Open round administration"}
                </small>
              </Link>
              {summary.standingsSummary ? (
                <Link
                  className="dashboard-summary-card"
                  href="/portal/standings"
                  aria-label="Open current Order of Merit standings"
                >
                  <span>Current Order of Merit</span>
                  <strong>
                    {summary.standingsSummary.leader?.name ??
                      "No ranked members"}
                  </strong>
                  <small>
                    {summary.standingsSummary.leader
                      ? `${summary.standingsSummary.leader.meritTotal ?? "0"} merit · ${summary.standingsSummary.memberCount} active members`
                      : `${summary.standingsSummary.memberCount} active members · Configure results to rank`}
                  </small>
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function formatDashboardDate(value: string | null, timeZone: string) {
  if (!value) return "date unavailable";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone,
    }).format(new Date(value));
  } catch {
    return "date unavailable";
  }
}

function formatActionRequiredInvitationSummary(
  summary: PortalDashboardSummary["actionRequiredInvitations"],
) {
  const labels = [
    summary.failedPermanent > 0
      ? `${summary.failedPermanent} failed permanently`
      : null,
    summary.suppressed > 0 ? `${summary.suppressed} suppressed` : null,
    summary.addressSuppression > 0
      ? `${summary.addressSuppression} provider suppression`
      : null,
  ];
  return labels.filter((label): label is string => label !== null).join(" · ");
}

function PortalState({
  email,
  kicker,
  title,
  message,
}: Readonly<{
  email?: string;
  kicker: string;
  title: string;
  message: string;
}>) {
  return (
    <PortalShell
      email={email ?? "Session details unavailable"}
      groupName="Group unavailable"
      roleStatus="Access not resolved"
      timeZone=""
    >
      <section className="portal-ledger">
        <p className="ledger-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </PortalShell>
  );
}
