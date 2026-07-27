export type MemberRosterQuotaProvenance = Readonly<{
  kind?: unknown;
}> | null;

export function formatMemberRosterQuotaProvenance(
  provenance: MemberRosterQuotaProvenance,
) {
  const kind = typeof provenance?.kind === "string" ? provenance.kind : null;
  if (!kind) return null;
  const labels: Readonly<Record<string, string>> = {
    initial_quota: "Initial quota",
    seed_history: "Seed history",
    method_c_chain: "Method C chain",
    official_history: "Official history",
    manual_override: "Manual override",
    not_ready: "Not ready",
  };
  return labels[kind] ?? "Not recorded";
}

export function formatMemberRosterInitialQuotaUsage(usesInitialQuota: boolean) {
  return usesInitialQuota
    ? "Use initial quota: Enabled"
    : "Use initial quota: Disabled";
}
