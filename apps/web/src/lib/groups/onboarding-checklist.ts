export type OnboardingChecklistItem = Readonly<{
  detail: string;
  key: "group-profile" | "rules" | "members" | "first-round";
  label: string;
  status: "complete" | "not-configured";
}>;

export function buildOnboardingChecklist(
  groupProfileComplete: boolean,
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
      label: "Select quota and game rules",
      status: "not-configured",
      detail: "No authoritative quota and game-rule configuration exists yet.",
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
