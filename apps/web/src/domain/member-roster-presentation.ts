export type MemberRosterQuotaProvenance = Readonly<{
  kind?: unknown;
}> | null;

export function formatMemberRosterQuotaProvenance(
  provenance: MemberRosterQuotaProvenance,
) {
  const kind = typeof provenance?.kind === "string" ? provenance.kind : null;
  if (!kind) return null;
  const labels: Readonly<Record<string, string>> = {
    initial_quota: "Starting quota",
    seed_history: "Seed history",
    method_c_chain: "Previous plus/minus adjustments",
    official_history: "From official results",
    manual_override: "Entered by hand",
    not_ready: "Not ready",
  };
  return labels[kind] ?? "Not set yet";
}

export function formatMemberRosterInitialQuotaUsage(usesInitialQuota: boolean) {
  return usesInitialQuota
    ? "Starting quota: in use"
    : "Starting quota: not in use";
}
