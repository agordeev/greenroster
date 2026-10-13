import Link from "next/link";
import type { ReactNode } from "react";

import { InformationFooter } from "@/app/information-footer";
import { BrandMark, SkipLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";

const navLinkClass =
  "rounded-sm py-3 text-sm font-semibold text-foreground no-underline decoration-flag decoration-2 underline-offset-[0.5em] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring";

// The layout for the calculator and the guides: pages a visitor reads without
// an account. It never checks who is signed in, so these pages stay static.
export function MarketingShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col p-[clamp(1.5rem,4vw,3rem)] max-[480px]:p-0 [&_[data-slot=information-footer]]:w-full">
      <SkipLink />
      <header
        className="mx-auto flex w-full max-w-288 flex-wrap items-center gap-x-6 gap-y-1 max-[480px]:px-4 max-[480px]:pt-4"
        data-slot="marketing-header"
      >
        <Link
          className="mr-auto inline-flex items-center gap-3 rounded-sm text-inherit no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring"
          href="/"
        >
          <BrandMark />
          <span className="font-heading text-[1.125rem] leading-tight font-semibold">
            GreenRoster
          </span>
        </Link>
        <nav
          className="flex flex-wrap items-center gap-x-6 max-[720px]:order-last max-[720px]:w-full"
          aria-label="Calculator and guides"
        >
          <Link className={navLinkClass} href="/tools/quota-calculator">
            Quota calculator
          </Link>
          <Link className={navLinkClass} href="/guides">
            Guides
          </Link>
          <Link className={navLinkClass} href="/sign-in">
            Sign in
          </Link>
        </nav>
        <Button asChild>
          <Link href="/sign-up">Start a group</Link>
        </Button>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto mt-8 w-full max-w-288 flex-1 animate-in outline-none duration-500 fade-in slide-in-from-bottom-2 max-[480px]:mt-6 max-[480px]:px-4"
      >
        {children}
      </main>
      <InformationFooter />
    </div>
  );
}
