import type { OnboardingChecklistItem } from "@/lib/groups/onboarding-checklist";

export function OnboardingChecklist({
  items,
}: Readonly<{ items: readonly OnboardingChecklistItem[] }>) {
  const completedCount = items.filter(
    (item) => item.status === "complete",
  ).length;

  return (
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-heading">
        <div>
          <p className="ledger-kicker">Group onboarding</p>
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
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <em>
              {item.status === "complete" ? "Complete" : "Not configured"}
            </em>
          </li>
        ))}
      </ol>
    </section>
  );
}
