import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { signInPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { buildOnboardingChecklist } from "@/lib/groups/onboarding-checklist";
import { ActionRow, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import type { PortalDashboardSummary } from "@/domain/portal-dashboard";
import { executePortalDashboardData } from "@/lib/portal/dashboard-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { GroupBootstrapForm } from "./group-bootstrap-form";
import { OnboardingChecklist } from "./onboarding-checklist";
import { PortalShell } from "./portal-shell";

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

export default async function PortalPage() {
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return (
      <PortalState
        kicker="Organizer portal"
        title="We couldn't check your sign-in"
        message="We can't check your sign-in right now. Try again in a moment."
      />
    );
  }

  const { data: userData, error: userError } = userResult;
  if (userError && isAuthRetryableFetchError(userError)) {
    return (
      <PortalState
        kicker="Organizer portal"
        title="We couldn't check your sign-in"
        message="We can't check your sign-in right now. Try again in a moment."
      />
    );
  }
  if (userError || !userData.user) redirect(signInPath("/portal"));

  if (!userData.user.email_confirmed_at) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="E-mail confirmation"
        title="Confirm your e-mail to continue"
        message="Confirm your e-mail address to join or create a group."
      />
    );
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== userData.user.id) {
    return (
      <PortalState
        email={userData.user.email}
        kicker="Organizer portal"
        title="We couldn't check your sign-in"
        message="We can't check your sign-in right now. Try again in a moment."
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
        kicker="Organizer portal"
        title="We couldn't check your sign-in"
        message="We can't check your sign-in right now. Try again in a moment."
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
        kicker="Password reset"
        title="Request a new password recovery link"
        message="This reset link has expired or was already used. Sign out, then request a new link if you still need to change your password."
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
        kicker="Organizer portal"
        title="We couldn't check your group access"
        message="We couldn't load your group. Sign out and try again."
      />
    );
  }

  if (!context) {
    const affiliation = await resolveIdentityAffiliation(userData.user.id);

    if (!affiliation.ok) {
      return (
        <PortalState
          email={userData.user.email}
          kicker="Organizer portal"
          title="We couldn't check your group access"
          message="We couldn't load your group. Sign out and try again."
        />
      );
    }

    if (affiliation.state !== "unattached") {
      return (
        <PortalState
          email={userData.user.email}
          kicker="Access unavailable"
          title="You're not an active member of a group"
          message="Ask a group administrator for help."
        />
      );
    }

    return (
      <PortalShell
        email={userData.user.email ?? "Verified account"}
        groupName="No group yet"
        roleStatus="Not set up yet"
        timeZone="Set during setup"
      >
        <section className="portal-ledger">
          <p className="ledger-kicker">First-time setup</p>
          <h1>Set up your group</h1>
          <p>Create your group, and you&apos;ll be its administrator.</p>
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
        kicker="Organizer portal"
        title="We couldn't load your group"
        message="We couldn't load your group. Sign out and try again."
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
          <p className="ledger-kicker">Access limited</p>
          <h1>This page is for coordinators and administrators</h1>
          <p>
            You&apos;re signed in as a member, so this page isn&apos;t available
            to you.
          </p>
          <ActionRow>
            <Button asChild>
              <Link href="/home">Home</Link>
            </Button>
            <Link className="secondary-link" href="/support">
              Contact support
            </Link>
          </ActionRow>
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
          <p className="ledger-kicker">Getting started</p>
          <h1>We couldn&apos;t load your setup progress</h1>
          <p>Refresh the page to keep setting up your group.</p>
        </section>
      </PortalShell>
    );
  }

  const checklist = buildOnboardingChecklist(
    onboarding.group_profile_complete,
    onboarding.quota_rules_configured,
    onboarding.additional_membership_count,
  );

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
        <p className="ledger-kicker">Your group</p>
        <h1>Welcome to your group</h1>
        <p>Set up your group, then run your rounds from here.</p>
        <PortalDashboardSummaryCard
          summary={dashboardSummary}
          timeZone={timeZone}
          unavailable={dashboardUnavailable}
        />
        <OnboardingChecklist items={checklist} />
      </section>
    </PortalShell>
  );
}

function PortalDashboardSummaryCard({
  summary,
  timeZone,
  unavailable,
}: Readonly<{
  summary: PortalDashboardSummary | null;
  timeZone: string;
  unavailable: boolean;
}>) {
  return (
    <section
      className="dashboard-summary"
      aria-labelledby="dashboard-summary-title"
    >
      <SectionHeading
        kicker="At a glance"
        title="Roster, results, and standings"
        titleId="dashboard-summary-title"
      />
      {unavailable ? (
        <p className="dashboard-summary-unavailable" data-status="error">
          We couldn&apos;t load your member and invitation counts. Refresh to
          try again.
        </p>
      ) : summary ? (
        <>
          <div className="dashboard-summary-grid">
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=pending"
              aria-label={`Review ${summary.membershipCounts.pending} pending members`}
            >
              <span>Pending members</span>
              <strong>{summary.membershipCounts.pending}</strong>
              <small>See members</small>
            </Link>
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=active"
              aria-label={`Review ${summary.membershipCounts.active} active members`}
            >
              <span>Active members</span>
              <strong>{summary.membershipCounts.active}</strong>
              <small>See members</small>
            </Link>
            <Link
              className="dashboard-summary-card"
              href="/portal/members?status=inactive"
              aria-label={`Review ${summary.membershipCounts.inactive} inactive members`}
            >
              <span>Inactive members</span>
              <strong>{summary.membershipCounts.inactive}</strong>
              <small>See members</small>
            </Link>
          </div>
          <Link
            className={`dashboard-action-summary${
              summary.actionRequiredInvitations.total === 0
                ? " dashboard-action-summary--clear"
                : ""
            }`}
            href="/portal/invitations?delivery=action-required"
            aria-label={`Review ${summary.actionRequiredInvitations.total} invitations with delivery problems`}
          >
            <span>
              <strong>
                {summary.actionRequiredInvitations.total === 0
                  ? "Invitations"
                  : "Invitations need attention"}
              </strong>
              <small>
                {summary.actionRequiredInvitations.total === 0
                  ? "No invitations failed to deliver"
                  : formatActionRequiredInvitationSummary(
                      summary.actionRequiredInvitations,
                    )}
              </small>
            </span>
            <strong>{summary.actionRequiredInvitations.total}</strong>
          </Link>
          {summary.notificationHealth ? (
            <section
              className="dashboard-notification-health"
              aria-labelledby="dashboard-notification-health-title"
            >
              <SectionHeading
                as="h3"
                kicker="Delivery"
                title="Notifications"
                titleId="dashboard-notification-health-title"
              />
              <div className="dashboard-summary-grid" data-columns="4">
                <div className="dashboard-summary-card">
                  <span>Waiting to send</span>
                  <strong>{summary.notificationHealth.queueDepth}</strong>
                  <small>
                    {summary.notificationHealth.oldestQueuedAt
                      ? `Waiting since ${formatHealthTimestamp(summary.notificationHealth.oldestQueuedAt, timeZone)}`
                      : "Nothing waiting"}
                  </small>
                </div>
                <div className="dashboard-summary-card">
                  <span>E-mails not delivered</span>
                  <strong>{summary.notificationHealth.emailFailures}</strong>
                  <small>
                    {formatHealthRate(
                      summary.notificationHealth.emailBounceRate,
                    )}{" "}
                    bounced ·{" "}
                    {formatHealthRate(
                      summary.notificationHealth.emailComplaintRate,
                    )}{" "}
                    marked as spam
                  </small>
                </div>
                <div className="dashboard-summary-card">
                  <span>Push not delivered</span>
                  <strong>{summary.notificationHealth.pushFailures}</strong>
                  <small>
                    {formatHealthRate(
                      summary.notificationHealth.pushInvalidTokenRate,
                    )}{" "}
                    of phones no longer reachable
                  </small>
                </div>
                <div className="dashboard-summary-card">
                  <span>Confirmations failed</span>
                  <strong>{summary.notificationHealth.receiptFailures}</strong>
                </div>
              </div>
            </section>
          ) : null}
          {summary.completedResult !== undefined || summary.standingsSummary ? (
            <div className="dashboard-summary-grid" data-columns="2">
              <Link
                className="dashboard-summary-card"
                href={
                  summary.completedResult
                    ? `/portal/rounds?round=${encodeURIComponent(summary.completedResult.roundId)}`
                    : "/portal/rounds"
                }
                aria-label="Open recent round results"
              >
                <span>Latest completed round</span>
                <strong>
                  {summary.completedResult
                    ? summary.completedResult.description || "Completed round"
                    : "No completed rounds"}
                </strong>
                <small>
                  {summary.completedResult
                    ? `${summary.completedResult.winnerNames.length > 0 ? summary.completedResult.winnerNames.join(" · ") : "No ranked winner"} · ${summary.completedResult.resultCount} results ·${formatDashboardDate(summary.completedResult.completedAt, summary.completedResult.groupTimeZone)}`
                    : "Go to rounds"}
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
                      : `${summary.standingsSummary.memberCount} active members · Complete a round to rank members`}
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
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone,
    }).format(new Date(value));
  } catch {
    return "date unavailable";
  }
}

function formatHealthTimestamp(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
    }).format(new Date(value));
  } catch {
    return "time unavailable";
  }
}

function formatHealthRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatActionRequiredInvitationSummary(
  summary: PortalDashboardSummary["actionRequiredInvitations"],
) {
  const labels = [
    summary.failedPermanent > 0
      ? `${summary.failedPermanent} failed to deliver`
      : null,
    summary.suppressed > 0 ? `${summary.suppressed} not sent` : null,
    summary.addressSuppression > 0
      ? `${summary.addressSuppression} blocked from sending`
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
      email={email ?? "Account details unavailable"}
      groupName="Group unavailable"
      roleStatus="Not checked yet"
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
