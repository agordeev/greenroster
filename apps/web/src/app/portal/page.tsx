import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { signInPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { buildOnboardingChecklist } from "@/lib/groups/onboarding-checklist";
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
        <OnboardingChecklist items={checklist} />
      </section>
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
