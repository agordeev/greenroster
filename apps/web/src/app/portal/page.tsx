import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { signInPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { buildOnboardingChecklist } from "@/lib/groups/onboarding-checklist";
import { PageHeader, PagePanel } from "@/components/blocks";
import type { PortalDashboardSummary } from "@/domain/portal-dashboard";
import { executePortalDashboardData } from "@/lib/portal/dashboard-data";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { GroupBootstrapForm } from "./group-bootstrap-form";
import { OnboardingChecklist } from "./onboarding-checklist";
import { PortalDashboard } from "./portal-dashboard";
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
        <PagePanel>
          <PageHeader kicker="First-time setup" title="Set up your group">
            Create your group, and you&apos;ll be its administrator.
          </PageHeader>
          <GroupBootstrapForm identityKey={userData.user.id} />
        </PagePanel>
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

  // Members have their own pages; the portal is for running the group.
  if (context.role === "member") redirect("/member/home");

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
        <PagePanel>
          <PageHeader
            kicker="Getting started"
            title="We couldn't load your setup progress"
          >
            Refresh the page to keep setting up your group.
          </PageHeader>
        </PagePanel>
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
      <div className="mx-auto mt-10 max-w-288 max-[480px]:mt-6 max-[480px]:px-4">
        <PageHeader kicker="Your group" title="Welcome to your group">
          Set up your group, then run your rounds from here.
        </PageHeader>
        <div className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <PortalDashboard
            summary={dashboardSummary}
            timeZone={timeZone}
            unavailable={dashboardUnavailable}
          />
          <OnboardingChecklist
            className="lg:sticky lg:top-6"
            items={checklist}
          />
        </div>
      </div>
    </PortalShell>
  );
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
      <PagePanel>
        <PageHeader kicker={kicker} title={title}>
          {message}
        </PageHeader>
      </PagePanel>
    </PortalShell>
  );
}
