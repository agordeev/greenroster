import Link from "next/link";

import type { OnboardingChecklistItem } from "@/lib/groups/onboarding-checklist";
import { Kicker } from "@/components/blocks";

const taskHref: Record<OnboardingChecklistItem["key"], string> = {
  "group-profile": "/portal/group",
  rules: "/portal/quota",
  members: "/portal/members/new",
  "first-round": "/portal/rounds?new=1",
};

export function OnboardingChecklist({
  items,
}: Readonly<{ items: readonly OnboardingChecklistItem[] }>) {
  const completedCount = items.filter(
    (item) => item.status === "complete",
  ).length;

  return (
    <section
      className="mt-10 border-t [&_[data-slot='section-heading']]:px-0 [&_[data-slot='section-heading']]:pt-6 [&_[data-slot='section-heading']]:pb-4"
      aria-labelledby="onboarding-title"
    >
      <div className="gap-4 flex items-end justify-between max-[720px]:items-start max-[720px]:flex-col [&>p]:mx-0 [&>p]:mb-0 [&>p]:text-muted-foreground [&>p]:whitespace-nowrap [&>p]:mt-0! [&>p]:text-[0.75rem]! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0">
        <div>
          <Kicker>Getting started</Kicker>
          <h2 id="onboarding-title">Finish setting up the group</h2>
        </div>
        <p aria-label={`${completedCount} of ${items.length} tasks complete`}>
          {completedCount}/{items.length} complete
        </p>
      </div>
      <ol className="m-0 p-0 border-b grid list-none [&_a]:text-primary [&_a]:underline-offset-[0.2em] [&_em]:text-muted-foreground [&_em]:text-[0.6875rem] [&_em]:not-italic [&_em]:tracking-[0.06em] [&_em]:uppercase max-[480px]:[&_em]:col-[2] [&_li>span]:border [&_li>span]:grid [&_li>span]:w-5 [&_li>span]:h-5 [&_li>span]:place-items-center [&_li>span]:rounded-full [&_li>span]:text-muted-foreground [&_li>span]:text-[0.75rem] [&_li[data-status='complete']>span]:border-primary [&_li[data-status='complete']>span]:bg-primary [&_li[data-status='complete']>span]:text-card [&_li[data-status='complete']_em]:text-primary [&_li[data-status='complete']_em]:font-bold [&_li]:py-4 [&_li]:px-0 [&_li]:gap-3 [&_li]:border-t [&_li]:border-t-border/50 [&_li]:grid [&_li]:grid-cols-[1.5rem_minmax(0,1fr)_auto] [&_li]:items-start max-[480px]:[&_li]:grid-cols-[1.5rem_minmax(0,1fr)]! [&_p]:mx-0 [&_p]:mt-1 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:text-[0.8125rem] [&_p]:leading-[1.5] [&_strong]:text-[1rem]">
        {items.map((item) => (
          <li key={item.key} data-status={item.status}>
            <span aria-hidden="true">
              {item.status === "complete" ? "✓" : "—"}
            </span>
            <div>
              <strong>
                {item.status === "complete" ? (
                  item.label
                ) : (
                  <Link href={taskHref[item.key]}>{item.label}</Link>
                )}
              </strong>
              <p>{item.detail}</p>
            </div>
            <em>{item.status === "complete" ? "Complete" : "To do"}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}
