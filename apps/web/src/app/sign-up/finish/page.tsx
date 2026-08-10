import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { resolveIdentityAffiliation } from "@/lib/auth/identity-affiliation";
import { resolveCurrentLegalDocuments } from "@/lib/auth/organizer-signup-data";
import {
  ORGANIZER_SIGNUP_COOKIE,
  readOrganizerSignupCookieValue,
} from "@/lib/auth/organizer-signup-state";
import { signInPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { OrganizerBootstrapForm } from "./organizer-bootstrap-form";
import { cookies } from "next/headers";

type SignupFinishPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function SignupFinishPage({
  searchParams,
}: SignupFinishPageProps) {
  const { status } = await searchParams;
  const supabase = await createServerComponentSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return (
      <FinishState
        title="Your account could not be checked"
        message="The sign-up service could not be reached. Try again in a moment."
      />
    );
  }

  if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
    return (
      <FinishState
        title="Your account could not be checked"
        message="The sign-up service could not be reached. Try again in a moment."
      />
    );
  }
  if (userResult.error || !userResult.data.user) {
    redirect(signInPath("/sign-up/finish"));
  }

  const user = userResult.data.user;
  if (!user.email_confirmed_at) {
    return (
      <FinishState
        title="Verify your account e-mail"
        message="Check your account e-mail, then open the verification link to continue."
        email={user.email}
      />
    );
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== user.id) {
    return (
      <FinishState
        title="Your account could not be checked"
        message="The sign-up service could not be reached. Try again in a moment."
      />
    );
  }

  const affiliation = await resolveIdentityAffiliation(user.id);
  if (!affiliation.ok) {
    return (
      <FinishState
        title="Your group access could not be checked"
        message="The sign-up service could not be reached. Try again in a moment."
      />
    );
  }
  if (affiliation.state === "attached") redirect("/portal");
  if (affiliation.state === "disabled") {
    return (
      <FinishState
        title="Your group access is not available"
        message="Ask a group administrator to review your access."
        email={user.email}
      />
    );
  }

  const legal = await resolveCurrentLegalDocuments();
  if (!legal) {
    return (
      <FinishState
        title="Your group setup could not be loaded"
        message="The sign-up service could not be reached. Try again in a moment."
        email={user.email}
      />
    );
  }

  const cookieStore = await cookies();
  const signupCookie = readOrganizerSignupCookieValue(
    cookieStore.get(ORGANIZER_SIGNUP_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="auth-shell auth-shell-single"
    >
      <section className="auth-ledger" aria-labelledby="finish-title">
        <div className="auth-heading">
          <p className="ledger-kicker">Group setup</p>
          <h1 id="finish-title">Add your group details</h1>
          <p>
            You verified {user.email ?? "your account"}. Add your name and group
            details to create your administrator access.
          </p>
        </div>
        {status === "expired" ? (
          <p className="form-message recovery-status" role="alert">
            This verification link has expired. Start again to receive a new
            link.
          </p>
        ) : status === "auth-unavailable" ? (
          <p className="form-message recovery-status" role="alert">
            The sign-up service could not be reached. Try again in a moment.
          </p>
        ) : null}
        <OrganizerBootstrapForm
          identityKey={user.id}
          legalAccepted={Boolean(
            signupCookie &&
            signupCookie.termsVersion === legal.termsVersion &&
            signupCookie.privacyVersion === legal.privacyVersion,
          )}
          privacyVersion={legal.privacyVersion}
          termsVersion={legal.termsVersion}
          operationId={randomUUID()}
        />
        <Link className="secondary-link" href="/sign-in">
          Sign out and return to sign in
        </Link>
      </section>
    </main>
  );
}

function FinishState({
  title,
  message,
  email,
}: Readonly<{ title: string; message: string; email?: string | null }>) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="auth-shell auth-shell-single"
    >
      <section className="auth-ledger" aria-labelledby="finish-state-title">
        <p className="ledger-kicker">Group setup</p>
        <h1 id="finish-state-title">{title}</h1>
        {email ? <p>{email}</p> : null}
        <p>{message}</p>
        <Link className="secondary-link" href="/sign-in">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
