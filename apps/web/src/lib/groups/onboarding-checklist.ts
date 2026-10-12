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
        ? "Your group name and time zone are set."
        : "Add the required group name and time zone.",
    },
    {
      key: "rules",
      label: "Choose quota rules",
      status: quotaRulesConfigured ? "complete" : "not-configured",
      detail: quotaRulesConfigured
        ? "Your quota rules are saved."
        : "You haven't chosen quota rules yet.",
    },
    {
      key: "members",
      label: "Invite or import members",
      status: additionalMembershipCount > 0 ? "complete" : "not-configured",
      detail:
        additionalMembershipCount > 0
          ? `${additionalMembershipCount} more ${additionalMembershipCount === 1 ? "member is" : "members are"} on your roster.`
          : "No other members are on your roster yet.",
    },
    {
      key: "first-round",
      label: "Create and publish the first round",
      status: "not-configured",
      detail: "You haven't published a round yet.",
    },
  ];
}
