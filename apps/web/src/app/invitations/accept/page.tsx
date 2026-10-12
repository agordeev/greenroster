import Link from "next/link";
import { cookies } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import {
  InvitationAcceptanceDataError,
  previewMembershipInvitation,
  type InvitationPreview,
} from "@/lib/invitations/invitation-acceptance-data";
import {
  INVITATION_ACCEPTANCE_COOKIE,
  readInvitationAcceptanceCookieValue,
} from "@/lib/invitations/invitation-acceptance-state";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

import { InvitationAcceptForm } from "./accept-form";

type InvitationAcceptPageProps = Readonly<{
  searchParams: Promise<{ status?: string }>;
}>;

function expiryLabel(expiresAt: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

function roleLabel(role: InvitationPreview["role"]): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function errorCopy(error: InvitationAcceptanceDataError): string {
  switch (error.code) {
    case "expired":
      return "This invitation has expired. Ask a group coordinator to send a new one.";
    case "revoked":
      return "This invitation is no longer available. Ask a group coordinator to send a new one.";
    case "already_used":
      return "This invitation has already been accepted. Sign in to continue to your group.";
    case "invalid":
    case "not_found":
      return "This invitation link is invalid or no longer available.";
    default:
      return "We cannot check this invitation right now. Try again in a moment.";
  }
}

function InvitationFrame({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section className="auth-ledger" aria-labelledby="invitation-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <div>
            <p className="eyebrow">GreenRoster</p>
            <p className="brand-note">Your group. Your rounds. One roster.</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

function StatusState({
  message,
  title = "Invitation unavailable",
}: Readonly<{ message: string; title?: string }>) {
  return (
    <InvitationFrame>
      <div className="auth-heading">
        <p className="ledger-kicker">Membership invitation</p>
        <h1 id="invitation-title">{title}</h1>
        <p>{message}</p>
      </div>
      <div className="information-actions invitation-recovery-actions">
        <Link className="primary-link" href="/sign-in">
          Sign in
        </Link>
        <Link className="secondary-link" href="/help">
          Get help
        </Link>
      </div>
    </InvitationFrame>
  );
}

export default async function InvitationAcceptPage({
  searchParams,
}: InvitationAcceptPageProps) {
  const { status } = await searchParams;
  const cookieStore = await cookies();
  const invitation = readInvitationAcceptanceCookieValue(
    cookieStore.get(INVITATION_ACCEPTANCE_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );

  if (!invitation) {
    return (
      <StatusState
        title={
          status === "invalid" ? "Invitation link not recognized" : undefined
        }
        message={
          status === "invalid"
            ? "We could not open this invitation link. Open the original e-mail again, or ask your group coordinator to send a new one."
            : "Open the original invitation link again, or ask a group coordinator to resend it."
        }
      />
    );
  }

  const supabase = await createServerComponentSupabaseClient();
  let user: Readonly<{
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
  }> | null = null;
  let authUnavailable = false;
  try {
    const userResult = await supabase.auth.getUser();
    if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
      authUnavailable = true;
    } else if (!userResult.error && userResult.data.user) {
      user = userResult.data.user;
    }
  } catch {
    authUnavailable = true;
  }

  if (authUnavailable) {
    return (
      <StatusState
        title="Account check unavailable"
        message="Try again in a moment. Your invitation is still saved in this browser."
      />
    );
  }

  if (!user) {
    return (
      <InvitationFrame>
        <div className="auth-heading">
          <p className="ledger-kicker">Membership invitation</p>
          <h1 id="invitation-title">Sign in to review your invitation</h1>
          <p>
            Sign in or create an account to see the group, who invited you, the
            invited e-mail address, the role, and when it expires. Your
            invitation stays saved in this browser while you do.
          </p>
        </div>
        <div className="information-actions invitation-recovery-actions">
          <Link
            className="primary-link"
            href="/sign-in?next=%2Finvitations%2Faccept"
          >
            Sign in to continue
          </Link>
          <Link className="secondary-link" href="/invitations/accept/register">
            Create an account
          </Link>
        </div>
      </InvitationFrame>
    );
  }

  if (!user.email_confirmed_at) {
    return (
      <StatusState
        title="Verify your account e-mail"
        message="Confirm your e-mail address, then open this invitation link again to review and accept it."
      />
    );
  }

  let preview: InvitationPreview;
  try {
    preview = await previewMembershipInvitation(
      user.id,
      invitation.invitationId,
      invitation.tokenDigest,
    );
  } catch (error) {
    return (
      <StatusState
        message={
          error instanceof InvitationAcceptanceDataError
            ? errorCopy(error)
            : "We cannot check this invitation right now. Try again in a moment."
        }
      />
    );
  }

  if (preview.status !== "pending") {
    return (
      <StatusState
        message={errorCopy(
          new InvitationAcceptanceDataError(
            preview.status === "accepted" ? "already_used" : preview.status,
          ),
        )}
      />
    );
  }

  let recoveryState:
    "none" | "active" | "expired" | "consumed" | "claimed" | "unavailable" =
    "none";
  if (user?.email_confirmed_at) {
    const claims = await resolveVerifiedSessionClaims(supabase);
    if (!claims || claims.sub !== user.id) {
      recoveryState = "unavailable";
    } else {
      recoveryState = await resolvePasswordRecoveryState(
        claims.session_id,
        claims.sub,
      );
    }
  }

  if (
    recoveryState === "active" ||
    recoveryState === "claimed" ||
    recoveryState === "expired" ||
    recoveryState === "consumed"
  ) {
    return (
      <StatusState
        title="Finish resetting your password first"
        message="You signed in from a password reset link, so you cannot accept an invitation yet. Finish resetting your password, then sign out, sign in normally, and open this invitation again."
      />
    );
  }
  if (recoveryState === "unavailable") {
    return (
      <StatusState
        title="Account check unavailable"
        message="Try again in a moment. Your invitation is still saved in this browser."
      />
    );
  }

  const accountEmail = user?.email ?? null;
  const emailMatches = accountEmail
    ? accountEmail.trim().toLowerCase() === preview.invitedEmail.toLowerCase()
    : null;

  return (
    <InvitationFrame>
      <div className="auth-heading">
        <p className="ledger-kicker">Membership invitation</p>
        <h1 id="invitation-title">
          {preview.memberFirstName}, you’re invited to {preview.groupName}
        </h1>
        <p>
          Check the details below before you accept. The invitation joins the
          account you are signed in with, even if its e-mail address is
          different.
        </p>
      </div>

      <dl className="invitation-summary">
        <div>
          <dt>Invited e-mail</dt>
          <dd>{preview.invitedEmail}</dd>
        </div>
        <div>
          <dt>Invited by</dt>
          <dd>{preview.inviterDisplayName}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel(preview.role)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{expiryLabel(preview.expiresAt)}</dd>
        </div>
        <div>
          <dt>Your account</dt>
          <dd>{accountEmail ?? "Not signed in"}</dd>
        </div>
        <div>
          <dt>E-mail match</dt>
          <dd>
            {emailMatches === null
              ? "Sign in to continue"
              : emailMatches
                ? "Matches the invitation"
                : "Different from the invitation. It will still join this account"}
          </dd>
        </div>
      </dl>

      <p className="field-help invitation-legal-note">
        Before you start, review the current <Link href="/terms">Terms</Link>{" "}
        and <Link href="/privacy">Privacy Policy</Link>.
      </p>

      {user?.email_confirmed_at ? (
        <InvitationAcceptForm />
      ) : (
        <div className="information-actions invitation-recovery-actions">
          <Link
            className="primary-link"
            href="/sign-in?next=%2Finvitations%2Faccept"
          >
            Sign in to accept
          </Link>
          <Link className="secondary-link" href="/invitations/accept/register">
            Create an account
          </Link>
        </div>
      )}
    </InvitationFrame>
  );
}
