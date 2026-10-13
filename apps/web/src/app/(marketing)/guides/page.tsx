import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/blocks";
import { Button } from "@/components/ui/button";

import { GuideLinks } from "./guide-links";
import { calculatorPath } from "./guides";

export const metadata: Metadata = {
  title: "Golf quota and points game guides · GreenRoster",
  description:
    "Plain guides to quota games: the rules, how to work out a quota, and how to run a regular points game for your group.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  return (
    <>
      <PageHeader kicker="Guides" title="Guides to golf quota games">
        How a quota game works, how to work out a quota, and how to run a
        regular points game for your group.
      </PageHeader>
      <div className="mt-4">
        <GuideLinks />
      </div>
      <p className="mt-8 mb-0 leading-[1.65] text-muted-foreground">
        Have your points totals to hand? Work out your quota now.
      </p>
      <Button asChild variant="outline" className="mt-3">
        <Link href={calculatorPath}>Open the quota calculator</Link>
      </Button>
    </>
  );
}
