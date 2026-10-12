import type { MutationErrorCode } from "../mutations/result";

type MemberImportObservedState =
  "uploaded" | "validating" | "ready" | "rejected" | "applying" | "completed";

export function memberImportWasRequeuedAfterApply(
  previous: MemberImportObservedState | null,
  current: MemberImportObservedState,
): boolean {
  return (
    previous === "applying" && current !== "applying" && current !== "completed"
  );
}

export type MemberImportFailurePlan = Readonly<{
  accessMessage: string;
  applyMessage: string;
  clearConfirmation: boolean;
  clearJob: boolean;
  refreshStatus: boolean;
  rotateOperationId: boolean;
}>;

export function memberImportAccessFailure(
  code: "authentication_required" | "forbidden",
): MemberImportFailurePlan {
  return {
    accessMessage:
      code === "authentication_required"
        ? "You've been signed out. Sign in again to continue."
        : "You no longer have access to this import.",
    applyMessage: "",
    clearConfirmation: false,
    clearJob: true,
    refreshStatus: false,
    rotateOperationId: false,
  };
}

export function memberImportApplyFailure(
  code: MutationErrorCode,
  correlationId: string,
): MemberImportFailurePlan {
  if (code === "authentication_required" || code === "forbidden") {
    return memberImportAccessFailure(code);
  }
  if (code === "stale_version") {
    return {
      accessMessage: "",
      applyMessage: "This import has changed. We're loading its latest status.",
      clearConfirmation: true,
      clearJob: false,
      refreshStatus: true,
      rotateOperationId: true,
    };
  }
  return {
    accessMessage: "",
    applyMessage: `We couldn't start the import. Try again, or contact support with reference ${correlationId}.`,
    clearConfirmation: false,
    clearJob: false,
    refreshStatus: false,
    rotateOperationId: false,
  };
}

export function memberImportApplyTransportFailure(): MemberImportFailurePlan {
  return {
    accessMessage: "",
    applyMessage:
      "We didn't hear back after you confirmed. We're loading the import's latest status.",
    clearConfirmation: false,
    clearJob: false,
    refreshStatus: true,
    rotateOperationId: false,
  };
}
