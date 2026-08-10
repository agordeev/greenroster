import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/app/actions/auth";
import { InformationFooter } from "@/app/information-footer";

type PortalRole = "member" | "coordinator" | "administrator";

const roleLabel: Record<PortalRole, string> = {
  member: "Member",
  coordinator: "Coordinator",
  administrator: "Administrator",
};

export function PortalShell({
  children,
  email,
  groupName,
  role,
  roleStatus,
  timeZone,
  currentSection = "home",
}: Readonly<{
  children: ReactNode;
  email: string;
  groupName: string;
  role?: PortalRole;
  roleStatus?: string;
  timeZone: string;
  currentSection?:
    | "home"
    | "members"
    | "invitations"
    | "rounds"
    | "standings"
    | "reports"
    | "group";
}>) {
  const visibleRole = role
    ? roleLabel[role]
    : (roleStatus ?? "Access not resolved");

  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="portal-header">
        <Link className="portal-brand" href="/portal">
          <span className="brand-mark" aria-hidden="true">
            GR
          </span>
          <span>
            <strong>GreenRoster</strong>
            <small>{groupName}</small>
          </span>
        </Link>

        <div className="portal-group" aria-label="Current group">
          <span>Group</span>
          <strong>{groupName}</strong>
          <small>{timeZone}</small>
        </div>

        <nav className="portal-nav" aria-label="Portal">
          <Link
            href="/portal"
            aria-current={currentSection === "home" ? "page" : undefined}
          >
            Home
          </Link>
          <Link
            href="/portal/members"
            aria-current={currentSection === "members" ? "page" : undefined}
          >
            Members
          </Link>
          <Link
            href="/portal/invitations"
            aria-current={currentSection === "invitations" ? "page" : undefined}
          >
            Invitations
          </Link>
          {role && role !== "member" ? (
            <Link
              href="/portal/rounds"
              aria-current={currentSection === "rounds" ? "page" : undefined}
            >
              Rounds
            </Link>
          ) : null}
          {role && role !== "member" ? (
            <Link
              href="/portal/standings"
              aria-current={currentSection === "standings" ? "page" : undefined}
            >
              Standings
            </Link>
          ) : null}
          {role && role !== "member" ? (
            <Link
              href="/portal/reports"
              aria-current={currentSection === "reports" ? "page" : undefined}
            >
              Reports
            </Link>
          ) : null}
          {role && role !== "member" ? (
            <Link
              href="/portal/group"
              aria-current={currentSection === "group" ? "page" : undefined}
            >
              Group
            </Link>
          ) : null}
          <Link href="/help">Help</Link>
        </nav>

        <div className="account-block">
          <div className="account-identity">
            <span>{email}</span>
            <strong>{visibleRole}</strong>
          </div>
          <details className="account-menu">
            <summary>Account</summary>
            <div>
              <span>{email}</span>
              <strong>{visibleRole}</strong>
              <Link href="/account">Account e-mail</Link>
              <Link href="/account/privacy">Privacy requests</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Use</Link>
            </div>
          </details>
          <form action={signOutAction}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="portal-main">
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
