import { redirect } from "next/navigation";
import Link from "next/link";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberInbox } from "@/lib/notifications/member-inbox-data";

import { MemberInboxList } from "./member-inbox-list";

export default async function MemberInboxPage() {
  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/inbox"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberInboxUnavailable />;

  let items;
  try {
    items = await executeReadMemberInbox(access.userId);
  } catch {
    return <MemberInboxUnavailable />;
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section className="auth-ledger" aria-labelledby="member-inbox-title">
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              Home
            </Link>
            <Link className="secondary-link" href="/member/profile">
              Profile
            </Link>
          </nav>
          <div className="auth-heading">
            <p className="ledger-kicker">Your inbox</p>
            <h1 id="member-inbox-title">Round updates</h1>
            <p className="member-home-intro">
              Updates from your coordinators and administrators appear here.
            </p>
            <MemberInboxList initialItems={items} />
          </div>
        </section>
      </main>
    </>
  );
}

function MemberInboxUnavailable() {
  return (
    <main className="auth-shell auth-shell-single invitation-shell">
      <section
        className="auth-ledger"
        aria-labelledby="member-inbox-unavailable-title"
      >
        <p className="ledger-kicker">Your inbox</p>
        <h1 id="member-inbox-unavailable-title">We couldn’t load your inbox</h1>
        <p>Refresh this page and try again.</p>
        <Link className="secondary-link" href="/member/home">
          Home
        </Link>
      </section>
    </main>
  );
}
