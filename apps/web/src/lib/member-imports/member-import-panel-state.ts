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
        ? "Your session expired. Sign in again to continue."
        : "Your role no longer permits access to this import.",
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
      applyMessage:
        "The import changed. Its current status is being refreshed.",
      clearConfirmation: true,
      clearJob: false,
      refreshStatus: true,
      rotateOperationId: true,
    };
  }
  return {
    accessMessage: "",
    applyMessage: `Apply could not be queued. Correlation ID: ${correlationId}`,
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
      "The confirmation response was lost. The current import status is being refreshed.",
    clearConfirmation: false,
    clearJob: false,
    refreshStatus: true,
    rotateOperationId: false,
  };
}
