import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { signOutAction } from "@/app/actions/auth";
import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { GroupBootstrapForm } from "./group-bootstrap-form";

const contextSchema = z
  .array(
    z.object({
      membership_id: z.uuid(),
      group_id: z.uuid(),
      role: z.enum(["member", "coordinator", "administrator"]),
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
  if (userError || !userData.user) redirect("/sign-in");

  if (!userData.user.email_confirmed_at) {
    return (
      <PortalState
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
          kicker="Protected portal"
          title="Your group access could not be checked"
          message="The service is temporarily unavailable. Sign out and try again."
        />
      );
    }

    if (affiliation.state !== "unattached") {
      return (
        <PortalState
          kicker="Access unavailable"
          title="Your group access is not active"
          message="You are signed in, but this identity does not have an active group membership. Ask a group administrator to review your access."
        />
      );
    }

    return (
      <main className="portal-empty">
        <p className="ledger-kicker">Administrator first run</p>
        <h1>Set up your group</h1>
        <p>
          Your verified account is ready. Group identity and your
          person-specific administrator access are created together.
        </p>
        <GroupBootstrapForm identityKey={userData.user.id} />
        <form action={signOutAction}>
          <button className="secondary-button" type="submit">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  if (context.role === "member") {
    return (
      <main className="portal-empty">
        <p className="ledger-kicker">Role denied</p>
        <h1>Portal access is not available for this role</h1>
        <p>
          You are signed in, but the administrative portal requires a
          coordinator or administrator role.
        </p>
        <form action={signOutAction}>
          <button className="secondary-button" type="submit">
            Sign out
          </button>
        </form>
      </main>
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

  return (
    <main className="portal-shell">
      <header className="club-card">
        <div>
          <p className="eyebrow">{groupName}</p>
          <p className="brand-note">{timeZone}</p>
        </div>
        <div className="club-person">
          <span>{userData.user.email}</span>
          <strong>{context.role}</strong>
          <form action={signOutAction}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <section className="portal-ledger">
        <p className="ledger-kicker">Clubhouse operations</p>
        <h1>Welcome to your group</h1>
        <p>
          The portal shell is authorized from your current stored membership.
          Group setup status follows stored configuration as each operational
          area is enabled.
        </p>
      </section>
    </main>
  );
}

function PortalState({
  kicker,
  title,
  message,
}: Readonly<{ kicker: string; title: string; message: string }>) {
  return (
    <main className="portal-empty">
      <p className="ledger-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <form action={signOutAction}>
        <button className="secondary-button" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
