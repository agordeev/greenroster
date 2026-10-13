import Link from "next/link";

import { BrandMark } from "@/components/blocks";

const links = [
  { id: "home", href: "/member/home", label: "Home" },
  { id: "standings", href: "/member/standings", label: "Standings" },
  { id: "inbox", href: "/member/inbox", label: "Inbox" },
  { id: "directory", href: "/member/directory", label: "Directory" },
  { id: "profile", href: "/member/profile", label: "Profile" },
] as const;

export type MemberNavSection = (typeof links)[number]["id"];

// The one navigation row every member page opens with, so the links are the
// same wherever you are.
export function MemberNav({
  current,
}: Readonly<{ current?: MemberNavSection }>) {
  return (
    <nav
      className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b pb-4 text-[0.875rem] [&_a]:py-2 [&_a]:font-medium [&_a]:text-muted-foreground [&_a]:no-underline [&_a]:underline-offset-[0.5em] [&_a]:decoration-flag [&_a]:decoration-2 [&_a:hover]:text-foreground [&_a:hover]:underline [&_a[aria-current=page]]:text-foreground [&_a[aria-current=page]]:underline"
      aria-label="Member navigation"
    >
      <BrandMark className="size-9 text-[0.8125rem] after:top-0.5 after:right-0.5" />
      {links.map((link) => (
        <Link
          key={link.id}
          href={link.href}
          aria-current={link.id === current ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
      <Link className="ml-auto max-[480px]:ml-0" href="/account">
        Account
      </Link>
    </nav>
  );
}
