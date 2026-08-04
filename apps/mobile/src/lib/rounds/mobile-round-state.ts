import type {
  MobileRoundDetail,
  MobileRoundRsvpReceipt,
  MobileRoundRsvpStatus,
} from "./mobile-rounds-api";

export type MobileRoundRsvpSyncState = "Confirmed" | "Pending" | "Failed";

export type MobileRoundDetailState = Readonly<{
  detail: MobileRoundDetail;
  confirmedStatus: MobileRoundRsvpStatus | "no_response";
  confirmedVersion: number | null;
  confirmedChangedAt: string | null;
  pendingStatus: MobileRoundRsvpStatus | null;
  syncState: MobileRoundRsvpSyncState;
  failure: string | null;
}>;

export function createMobileRoundDetailState(
  detail: MobileRoundDetail,
): MobileRoundDetailState {
  return {
    detail,
    confirmedStatus: detail.participantStatus,
    confirmedVersion: detail.participantVersion,
    confirmedChangedAt: detail.rsvpChangedAt,
    pendingStatus: null,
    syncState: "Confirmed",
    failure: null,
  };
}

export function markMobileRoundRsvpPending(
  state: MobileRoundDetailState,
  status: MobileRoundRsvpStatus,
): MobileRoundDetailState {
  return {
    ...state,
    pendingStatus: status,
    syncState: "Pending",
    failure: null,
  };
}

export function applyMobileRoundRsvpReceipt(
  state: MobileRoundDetailState,
  receipt: MobileRoundRsvpReceipt,
): MobileRoundDetailState {
  if (receipt.roundId !== state.detail.roundId) return state;
  return {
    ...state,
    detail: {
      ...state.detail,
      participantStatus: receipt.rsvpStatus,
      participantVersion: receipt.version,
      rsvpChangedAt: receipt.changedAt,
    },
    confirmedStatus: receipt.rsvpStatus,
    confirmedVersion: receipt.version,
    confirmedChangedAt: receipt.changedAt,
    pendingStatus: null,
    syncState: "Confirmed",
    failure: null,
  };
}

export function markMobileRoundRsvpFailed(
  state: MobileRoundDetailState,
  message: string,
): MobileRoundDetailState {
  return {
    ...state,
    pendingStatus: null,
    syncState: "Failed",
    failure: message,
  };
}

export function replaceMobileRoundDetail(
  state: MobileRoundDetailState,
  detail: MobileRoundDetail,
): MobileRoundDetailState {
  return {
    ...createMobileRoundDetailState(detail),
    pendingStatus: state.pendingStatus,
    syncState: state.syncState,
    failure: state.failure,
  };
}
