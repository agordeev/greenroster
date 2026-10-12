import Link from "next/link";

import type { OnboardingChecklistItem } from "@/lib/groups/onboarding-checklist";

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
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="section-heading">
        <div>
          <p className="ledger-kicker">Getting started</p>
          <h2 id="onboarding-title">Finish setting up the group</h2>
        </div>
        <p aria-label={`${completedCount} of ${items.length} tasks complete`}>
          {completedCount}/{items.length} complete
        </p>
      </div>
      <ol className="onboarding-list">
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
