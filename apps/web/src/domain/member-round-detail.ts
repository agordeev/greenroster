export type MemberRoundDetail = Readonly<{
  roundId: string;
  groupId: string;
  description: string | null;
  scheduledAt: string | null;
  groupTimeZone: string;
  venue: string | null;
  roundUrl: string | null;
  notes: string | null;
  format: "individual_net" | "individual_gross";
  state: "published" | "live" | "completed" | "cancelled";
  version: number;
  rsvpDeadlineAt: string | null;
  participantStatus: "no_response" | "playing" | "not_playing";
  participantVersion: number | null;
  rsvpChangedAt: string | null;
  participantCount: number;
  playingCount: number;
  cancelledAt: string | null;
  cancellationReason: string | null;
  updatedAt: string;
}>;

export type MemberRoundGuest = Readonly<{
  participantId: string;
  sponsorMembershipId: string;
  firstName: string;
  lastName: string;
  rsvpStatus: "playing" | "not_playing";
  version: number;
  quotaSnapshot: string | null;
  handicapSnapshot: string | null;
  teeSnapshot: "pro" | "back" | "middle" | "front" | null;
  duplicateLike: boolean;
  changedAt: string;
}>;

export type MemberRoundGuestContext = Readonly<{
  roundId: string;
  groupId: string;
  format: "individual_net" | "individual_gross";
  state: "published" | "live";
  canManage: boolean;
  guests: readonly MemberRoundGuest[];
}>;
