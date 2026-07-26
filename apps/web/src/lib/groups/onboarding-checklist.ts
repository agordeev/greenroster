export type OnboardingChecklistItem = Readonly<{
  detail: string;
  key: "group-profile" | "rules" | "members" | "first-round";
  label: string;
  status: "complete" | "not-configured";
}>;

export function buildOnboardingChecklist(
  groupProfileComplete: boolean,
  quotaRulesConfigured: boolean,
  additionalMembershipCount: number,
): readonly OnboardingChecklistItem[] {
  return [
    {
      key: "group-profile",
      label: "Complete the group profile",
      status: groupProfileComplete ? "complete" : "not-configured",
      detail: groupProfileComplete
        ? "The stored group name and time zone are ready."
        : "Add the required group name and time zone.",
    },
    {
      key: "rules",
      label: "Select quota rules",
      status: quotaRulesConfigured ? "complete" : "not-configured",
      detail: quotaRulesConfigured
        ? "The authoritative quota calculation policy is configured."
        : "No authoritative quota calculation policy exists yet.",
    },
    {
      key: "members",
      label: "Invite or import members",
      status: additionalMembershipCount > 0 ? "complete" : "not-configured",
      detail:
        additionalMembershipCount > 0
          ? `${additionalMembershipCount} additional membership${additionalMembershipCount === 1 ? " is" : "s are"} stored for this group.`
          : "No additional membership is stored for this group.",
    },
    {
      key: "first-round",
      label: "Create and publish the first round",
      status: "not-configured",
      detail: "No authoritative published-round record exists yet.",
    },
  ];
}
