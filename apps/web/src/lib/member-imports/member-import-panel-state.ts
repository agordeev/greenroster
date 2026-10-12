import type { MutationErrorCode } from "../mutations/result";
import type { SubmittedMemberImport } from "./member-import-upload";

type MemberImportObservedState = SubmittedMemberImport["state"];

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

function failurePlan(
  plan: Partial<MemberImportFailurePlan>,
): MemberImportFailurePlan {
  return {
    accessMessage: "",
    applyMessage: "",
    clearConfirmation: false,
    clearJob: false,
    refreshStatus: false,
    rotateOperationId: false,
    ...plan,
  };
}

export function memberImportAccessFailure(
  code: "authentication_required" | "forbidden",
): MemberImportFailurePlan {
  return failurePlan({
    accessMessage:
      code === "authentication_required"
        ? "You've been signed out. Sign in again to continue."
        : "You no longer have access to this import.",
    clearJob: true,
  });
}

export function memberImportApplyFailure(
  code: MutationErrorCode,
  correlationId: string,
): MemberImportFailurePlan {
  if (code === "authentication_required" || code === "forbidden") {
    return memberImportAccessFailure(code);
  }
  if (code === "stale_version") {
    return failurePlan({
      applyMessage: "This import has changed. We're loading its latest status.",
      clearConfirmation: true,
      refreshStatus: true,
      rotateOperationId: true,
    });
  }
  return failurePlan({
    applyMessage: `We couldn't start the import. Try again, or contact support with reference ${correlationId}.`,
  });
}

export function memberImportApplyTransportFailure(): MemberImportFailurePlan {
  return failurePlan({
    applyMessage:
      "We didn't hear back after you confirmed. We're loading the import's latest status.",
    refreshStatus: true,
  });
}
