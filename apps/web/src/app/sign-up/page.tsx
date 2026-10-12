import Link from "next/link";

import { resolveCurrentLegalDocuments } from "@/lib/auth/organizer-signup-data";

import { OrganizerSignupForm } from "./signup-form";

type SignupPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { status } = await searchParams;
  const legal = await resolveCurrentLegalDocuments();

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single"
      >
        <section className="auth-ledger" aria-labelledby="sign-up-title">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              GR
            </span>
            <div>
              <p className="eyebrow">GreenRoster</p>
              <p className="brand-note">Your group. Your rounds. One roster.</p>
            </div>
          </div>

          <div className="auth-heading">
            <p className="ledger-kicker">Organizer signup</p>
            <h1 id="sign-up-title">Start your group</h1>
            <p>
              Create your account, then add your group details and open your
              administrator portal.
            </p>
          </div>

          {status === "auth-unavailable" ? (
            <p className="form-message recovery-status" role="alert">
              You cannot create your account right now. Try again in a moment.
            </p>
          ) : status === "expired" ? (
            <p className="form-message recovery-status" role="alert">
              Your verification link has expired. Start again to receive a new
              link.
            </p>
          ) : null}

          {legal ? (
            <OrganizerSignupForm
              privacyVersion={legal.privacyVersion}
              termsVersion={legal.termsVersion}
            />
          ) : (
            <div className="form-message" role="alert">
              <p>
                Organizer sign-up is paused. The Terms of Use and Privacy Policy
                are not published yet.
              </p>
              <p>
                Read the current <Link href="/terms">Terms of Use</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>. The sign-up form
                will appear once both are published.
              </p>
            </div>
          )}

          <Link className="secondary-link" href="/sign-in">
            Sign in instead
          </Link>
        </section>
      </main>
    </>
  );
}
