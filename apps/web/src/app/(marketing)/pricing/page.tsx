import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { pricingSignupSource } from "@/lib/auth/signup-source";

const signUpPath = `/sign-up?from=${pricingSignupSource}`;

export const metadata: Metadata = {
  title: "Pricing · GreenRoster",
  description:
    "GreenRoster is free right now. Start a group, invite your members and run your quota game without a card.",
  alternates: { canonical: "/pricing" },
};

// What GreenRoster costs. There is no price yet (owner, 2026-10-20), so the
// page says it is free and how paying will work, without an amount.
const includedToday = [
  "Post rounds and see who’s playing",
  "Enter points and get ranked results",
  "Get a new quota for every player after each round",
  "Keep the season’s Order of Merit",
  "Let your members see their results and standings",
] as const;

const laterTerms = [
  {
    title: "You pay for the group",
    body: "You get one bill as the organizer. Your members never pay.",
  },
  {
    title: "Guests are free",
    body: "You don’t pay for guests your members bring to a round.",
  },
  {
    title: "30 days free",
    body: "You get 30 days free when you start a group, and you enter a card to begin.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <PageHeader kicker="Pricing" title="GreenRoster is free right now.">
        Start a group, invite your members and run your rounds at no charge. You
        don’t need a card.
      </PageHeader>
      <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
        <Card className="gap-0 border-t-[3px] border-t-primary p-[clamp(1.25rem,3vw,2rem)]">
          <h2 className="m-0 text-[1.625rem] leading-[1.15]">
            What you get today
          </h2>
          <ul className="mt-5 mb-0 list-none border-b p-0 text-sm leading-[1.55] text-foreground/85 [&>li]:border-t [&>li]:py-2.5">
            {includedToday.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Button asChild className="mt-6 self-start max-[480px]:w-full">
            <Link href={signUpPath}>Start a group</Link>
          </Button>
        </Card>
        <Card className="gap-0 p-[clamp(1.25rem,3vw,2rem)]">
          <h2 className="m-0 text-[1.625rem] leading-[1.15]">
            When you start paying
          </h2>
          <p className="mt-3 mb-0 text-sm leading-[1.6] text-foreground/80">
            We haven’t set a price yet. Here’s how paying will work.
          </p>
          <dl className="mt-5 mb-0 border-b">
            {laterTerms.map((term) => (
              <div key={term.title} className="border-t py-3">
                <dt className="font-semibold">{term.title}</dt>
                <dd className="mt-0.5 ml-0 text-sm leading-[1.55] text-muted-foreground">
                  {term.body}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
