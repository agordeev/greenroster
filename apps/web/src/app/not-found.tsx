import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/app/marketing-shell";
import { Kicker, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";

import { calculatorPath } from "./(marketing)/guides/guides";

export const metadata: Metadata = {
  title: "Page not found · GreenRoster",
  robots: { index: false, follow: false },
};

// Shown for any address the app doesn't know, inside the same header and
// footer as the public pages so a visitor always has a way back.
export default function NotFound() {
  return (
    <MarketingShell>
      <section
        aria-labelledby="not-found-title"
        className="max-w-160 pt-4 lg:pt-10"
      >
        <Kicker>Page not found</Kicker>
        <h1
          id="not-found-title"
          className="mt-4 mb-0 text-[length:clamp(2rem,5vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.025em]"
        >
          We can’t find that page
        </h1>
        <p className="mt-5 mb-0 text-[1.0625rem] leading-[1.65] text-foreground/85">
          The link may be old or mistyped.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3 max-[480px]:[&>a]:w-full">
          <Button asChild>
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={calculatorPath}>Try the quota calculator</Link>
          </Button>
        </div>
        <p className="mt-5 mb-0 text-sm leading-[1.55] text-muted-foreground">
          Looking for help with quotas or scoring?{" "}
          <TextLink href="/guides">Read the guides</TextLink>.
        </p>
      </section>
    </MarketingShell>
  );
}
