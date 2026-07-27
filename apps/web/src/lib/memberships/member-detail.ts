export type MemberDetailProjection = Readonly<{
  membershipId: string;
  groupId: string;
  actorRole: "coordinator" | "administrator";
  accountEmail: string | null;
  invitations: readonly MemberDetailInvitation[];
  deliveries: readonly MemberDetailDelivery[];
  quota: MemberDetailQuota;
  handicaps: readonly MemberDetailHandicap[];
  activity: readonly MemberDetailActivity[];
}>;

export type MemberDetailInvitation = Readonly<{
  invitationId: string;
  invitedEmail: string;
  role: "member" | "coordinator" | "administrator";
  status: "pending" | "accepted" | "revoked" | "expired";
  issuedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiredAt: string | null;
  version: number;
}>;

export type MemberDetailDelivery = Readonly<{
  deliveryId: string;
  eventType: string;
  recipientAddress: string;
  channel: "email";
  state:
    | "queued"
    | "sending"
    | "sent"
    | "retryable"
    | "failed_permanent"
    | "suppressed"
    | "cancelled";
  attempts: number;
  failureReason: string | null;
  suppressionReason: "bounce" | "complaint" | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type MemberDetailQuota = Readonly<{
  projectionReady: boolean;
  projectedQuota: string | null;
  projectionSource: Readonly<Record<string, unknown>>;
  projectionEffectiveAt: string | null;
  projectionVersion: number;
  history: readonly MemberDetailQuotaHistory[];
  administratorDetails: Readonly<{
    initialQuota: string | null;
    usesInitialQuota: boolean;
    initialQuotaProvenance: string | null;
    seedTotals: readonly Readonly<{
      position: number;
      pointTotal: string;
    }>[];
    settingsVersion: number;
    settingsMethod:
      "moving_average" | "best_10_of_20" | "previous_plus_minus" | null;
    settingsHistoryLength: number | null;
    settingsPrecision: 0 | 1 | 2 | null;
    settingsRoundingRule: "half_away_from_zero" | null;
  }> | null;
}>;

export type MemberDetailQuotaHistory = Readonly<{
  eventId: string;
  projectionVersion: number;
  settingsVersion: number;
  projectionReady: boolean;
  projectedQuota: string | null;
  projectionSource: Readonly<Record<string, unknown>>;
  occurredAt: string;
  reason: string | null;
  source: string;
  administratorDetails: Readonly<{
    initialQuota: string | null;
    usesInitialQuota: boolean;
    initialQuotaProvenance: string | null;
    seedTotals: readonly Readonly<{
      position: number;
      pointTotal: string;
    }>[];
  }> | null;
}>;

export type MemberDetailHandicap = Readonly<{
  recordId: string;
  handicapId: string | null;
  handicap: string;
  source: "manual" | "import";
  asOf: string;
  createdAt: string;
}>;

export type MemberDetailActivity = Readonly<{
  eventId: string;
  action: string;
  source: string;
  reason: string | null;
  targetVersion: number | null;
  occurredAt: string;
}>;
