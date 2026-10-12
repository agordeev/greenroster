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
import { Button } from "@/components/ui/button";

import { InvitationAcceptForm } from "./accept-form";
import { Kicker, TextLink } from "@/components/blocks";

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
    <main className="p-8 min-h-screen grid grid-cols-[minmax(20rem,38rem)] place-content-center max-[800px]:grid-cols-[1fr] max-[480px]:p-0 [&_[data-slot=auth-ledger]]:border [&_[data-slot=auth-ledger]]:min-h-auto [&_[data-slot=auth-ledger]]:w-[min(100%,52rem)] max-[480px]:[&_[data-slot=auth-ledger]]:border-0! max-[480px]:[&_[data-slot=auth-ledger]]:w-full!">
      <section
        className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
        data-slot="auth-ledger"
        aria-labelledby="invitation-title"
      >
        <div className="mb-[clamp(3rem,9vh,6.5rem)] gap-3.5 flex items-center max-[800px]:mb-12">
          <span
            className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
            aria-hidden="true"
          >
            GR
          </span>
          <div>
            <p className="m-0 text-[1.125rem] font-bold">GreenRoster</p>
            <p className="mx-0 mt-0.5 mb-0 text-muted-foreground text-[0.8125rem]">
              Your group. Your rounds. One roster.
            </p>
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
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>Invitation</Kicker>
        <h1 id="invitation-title">{title}</h1>
        <p>{message}</p>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <TextLink href="/help">Get help</TextLink>
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
          status === "invalid"
            ? "This invitation link didn&apos;t work"
            : undefined
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
        title="We couldn't check your account"
        message="Try again in a moment. Your invitation is still open in this browser."
      />
    );
  }

  if (!user) {
    return (
      <InvitationFrame>
        <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
          <Kicker>Invitation</Kicker>
          <h1 id="invitation-title">Sign in to review your invitation</h1>
          <p>
            Sign in or create an account to see who invited you and which group
            you&apos;re joining.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5">
          <Button asChild>
            <Link href="/sign-in?next=%2Finvitations%2Faccept">
              Sign in to continue
            </Link>
          </Button>
          <TextLink href="/invitations/accept/register">
            Create an account
          </TextLink>
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
        message="You signed in with a password reset link, so you can't accept an invitation yet. Finish resetting your password, sign in with it, and open this invitation again."
      />
    );
  }
  if (recoveryState === "unavailable") {
    return (
      <StatusState
        title="We couldn't check your account"
        message="Try again in a moment. Your invitation is still open in this browser."
      />
    );
  }

  const accountEmail = user?.email ?? null;
  const emailMatches = accountEmail
    ? accountEmail.trim().toLowerCase() === preview.invitedEmail.toLowerCase()
    : null;

  return (
    <InvitationFrame>
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>Invitation</Kicker>
        <h1 id="invitation-title">
          {preview.memberFirstName}, you’re invited to {preview.groupName}
        </h1>
        <p>Check the details below before you accept.</p>
      </div>

      <dl
        className="mx-0 mt-9 mb-0 pt-6 border-t grid grid-cols-2 gap-y-4 gap-x-6 max-[480px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-[0.3rem] [&_dd]:mb-0 [&_dd]:text-foreground [&_dd]:wrap-anywhere [&_div]:min-w-0 [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.1em] [&_dt]:uppercase"
        data-slot="invitation-summary"
      >
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
          <dt>Your e-mail</dt>
          <dd>
            {emailMatches === null
              ? "Sign in to continue"
              : emailMatches
                ? "Matches the invitation"
                : "Different from the invitation. You'll still join with this account"}
          </dd>
        </div>
      </dl>

      <p
        className="mx-0 mt-6 mb-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground max-w-168 [&_a]:underline [&_a]:text-primary [&_a]:font-bold [&_a]:underline-offset-[0.2em]"
        data-slot="field-help"
      >
        Before you start, review the current <Link href="/terms">Terms</Link>{" "}
        and <Link href="/privacy">Privacy Policy</Link>.
      </p>

      {user?.email_confirmed_at ? (
        <InvitationAcceptForm />
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-y-3 gap-x-5">
          <Button asChild>
            <Link href="/sign-in?next=%2Finvitations%2Faccept">
              Sign in to accept
            </Link>
          </Button>
          <TextLink href="/invitations/accept/register">
            Create an account
          </TextLink>
        </div>
      )}
    </InvitationFrame>
  );
}
