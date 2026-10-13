import type { Metadata } from "next";

import { calculatorPath } from "@/app/(marketing)/guides/guides";
import { GuideLinks } from "@/app/(marketing)/guides/guide-links";
import { PageHeader, SectionHeading } from "@/components/blocks";

import { QuotaCalculator } from "./quota-calculator";

export const metadata: Metadata = {
  title: "Golf quota calculator · GreenRoster",
  description:
    "Work out your golf quota from your recent points totals. Free, and you don't need an account.",
  alternates: { canonical: calculatorPath },
};

export default function QuotaCalculatorPage() {
  return (
    <>
      <PageHeader kicker="Free calculator" title="Golf quota calculator">
        Type the points you scored in your recent rounds and see your quota: the
        points you are expected to score next time out. You don’t need an
        account.
      </PageHeader>

      <div className="mt-8">
        <QuotaCalculator />
      </div>

      <section className="mt-12" aria-labelledby="calculator-guides-title">
        <SectionHeading
          kicker="Guides"
          title="How quotas work"
          titleId="calculator-guides-title"
        />
        <GuideLinks />
      </section>
    </>
  );
}
