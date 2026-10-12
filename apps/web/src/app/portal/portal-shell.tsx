import Link from "next/link";
import type { ReactNode } from "react";

import { InformationFooter } from "@/app/information-footer";

import { AccountMenu } from "./account-menu";
import { SkipLink } from "@/components/blocks";

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
      href: "/portal/standings",
      label: "Standings",
      sections: ["standings"],
      roles: organizers,
    },
    {
      href: "/portal/reports",
      label: "Reports",
      sections: ["reports"],
      roles: organizers,
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
    : (roleStatus ?? "Role unavailable");
  const allowed = (item: NavItem) =>
    role ? item.roles.includes(role) : item.roles === everyone;
  const tabs = (
    secondaryNav.find((group) =>
      group.some((item) => item.sections.includes(currentSection)),
    ) ?? []
  ).filter(allowed);

  return (
    <div className="p-[clamp(1.5rem,4vw,3rem)] min-h-screen bg-background max-[480px]:p-0">
      <SkipLink />
      <header className="mx-auto py-4 px-6 border grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-y-3 gap-x-8 max-w-288 bg-card max-[800px]:grid-cols-[minmax(0,1fr)_auto] max-[480px]:p-4 max-[480px]:border-x-0 max-[480px]:border-t-0 max-[480px]:border-b">
        <Link
          className="gap-3 inline-flex items-center text-inherit no-underline [&>span:last-child]:gap-0.5 [&>span:last-child]:grid [&>span:last-child]:min-w-0 [&_small]:text-muted-foreground [&_small]:text-[0.75rem] [&_small]:wrap-anywhere [&_strong]:text-[1rem] [&_strong]:tracking-[0.02em]"
          href="/portal"
        >
          <span
            className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
            aria-hidden="true"
          >
            GR
          </span>
          <span>
            <strong>GreenRoster</strong>
            <small>{groupName}</small>
          </span>
        </Link>

        <nav
          className="flex items-center min-w-0 flex-wrap gap-y-1 gap-x-4 max-[800px]:col-span-full max-[800px]:[grid-row:2] [&_a:hover]:text-foreground [&_a[aria-current]]:border-b-primary [&_a[aria-current]]:font-bold [&_a[aria-current]]:text-primary! [&_a]:border-y-2 [&_a]:border-t-transparent [&_a]:border-b-transparent [&_a]:text-muted-foreground [&_a]:text-[0.8125rem] [&_a]:underline-offset-[0.25rem] [&_a]:inline-flex [&_a]:min-h-[2.75rem] [&_a]:items-center [&_a]:no-underline"
          aria-label="Portal"
        >
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

        <AccountMenu email={email} role={visibleRole} />
      </header>
      {tabs.length > 1 ? (
        <nav
          className="my-0 mx-auto px-6 pt-2 pb-0 border-b flex flex-wrap gap-y-1 gap-x-6 max-w-288 [&_a:hover]:text-foreground! [&_a[aria-current='page']]:border-b-primary [&_a[aria-current='page']]:font-bold [&_a[aria-current='page']]:text-primary! [&_a]:mb-[-1px] [&_a]:py-2.5 [&_a]:border-b-2 [&_a]:border-b-transparent [&_a]:text-muted-foreground [&_a]:text-[0.8125rem] [&_a]:no-underline"
          aria-label="Section"
        >
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
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-[calc(100vh_-_15rem)]"
      >
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
