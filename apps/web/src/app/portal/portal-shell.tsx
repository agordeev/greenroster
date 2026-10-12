import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/app/actions/auth";
import { InformationFooter } from "@/app/information-footer";

type PortalRole = "member" | "coordinator" | "administrator";

type PortalSection =
  | "home"
  | "members"
  | "invitations"
  | "rounds"
  | "standings"
  | "reports"
  | "group"
  | "quota"
  | "content"
  | "branding"
  | "billing";

type NavItem = Readonly<{
  href: string;
  label: string;
  // Sections that light this item up; the first one is the item itself.
  sections: readonly PortalSection[];
  roles: readonly PortalRole[];
}>;

const everyone = ["member", "coordinator", "administrator"] as const;
const organizers = ["coordinator", "administrator"] as const;
const administrators = ["administrator"] as const;

const primaryNav: readonly NavItem[] = [
  { href: "/portal", label: "Home", sections: ["home"], roles: everyone },
  {
    href: "/portal/members",
    label: "Members",
    sections: ["members", "invitations"],
    roles: everyone,
  },
  {
    href: "/portal/rounds",
    label: "Rounds",
    sections: ["rounds"],
    roles: organizers,
  },
  {
    href: "/portal/standings",
    label: "Standings",
    sections: ["standings", "reports"],
    roles: organizers,
  },
  {
    href: "/portal/content",
    label: "Clubhouse",
    sections: ["content"],
    roles: organizers,
  },
  {
    href: "/portal/group",
    label: "Settings",
    sections: ["group", "quota", "branding", "billing"],
    roles: organizers,
  },
];

const secondaryNav: readonly (readonly NavItem[])[] = [
  [
    {
      href: "/portal/members",
      label: "Roster",
      sections: ["members"],
      roles: everyone,
    },
    {
      href: "/portal/invitations",
      label: "Invitations",
      sections: ["invitations"],
      roles: everyone,
    },
  ],
  [
    {
      href: "/portal/group",
      label: "Group",
      sections: ["group"],
      roles: organizers,
    },
    {
      href: "/portal/quota",
      label: "Quota rules",
      sections: ["quota"],
      roles: administrators,
    },
    {
      href: "/portal/branding",
      label: "Branding",
      sections: ["branding"],
      roles: administrators,
    },
    {
      href: "/portal/billing",
      label: "Billing",
      sections: ["billing"],
      roles: administrators,
    },
  ],
];

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
  currentSection = "home",
}: Readonly<{
  children: ReactNode;
  email: string;
  groupName: string;
  role?: PortalRole;
  roleStatus?: string;
  timeZone: string;
  currentSection?: PortalSection;
}>) {
  const visibleRole = role
    ? roleLabel[role]
    : (roleStatus ?? "Access not resolved");
  const allowed = (item: NavItem) =>
    role ? item.roles.includes(role) : item.roles === everyone;
  const tabs = (
    secondaryNav.find((group) =>
      group.some((item) => item.sections.includes(currentSection)),
    ) ?? []
  ).filter(allowed);

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

        <nav className="portal-nav" aria-label="Portal">
          {primaryNav.filter(allowed).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={
                item.sections[0] === currentSection
                  ? "page"
                  : item.sections.includes(currentSection)
                    ? "true"
                    : undefined
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="account-block">
          <details className="account-menu">
            <summary>Account</summary>
            <div>
              <span>{email}</span>
              <strong>{visibleRole}</strong>
              <Link href="/account">Account e-mail</Link>
              <Link href="/account/privacy">Privacy requests</Link>
              <Link href="/help">Help</Link>
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
      {tabs.length > 1 ? (
        <nav className="portal-tabs" aria-label="Section">
          {tabs.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={
                item.sections.includes(currentSection) ? "page" : undefined
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <main id="main-content" tabIndex={-1} className="portal-main">
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
