import { describe, expect, it } from "vitest";

import {
  memberImportAccessFailure,
  memberImportApplyFailure,
  memberImportApplyTransportFailure,
  memberImportWasRequeuedAfterApply,
} from "../apps/web/src/lib/member-imports/member-import-panel-state";

describe("member import client failure state", () => {
  it.each(["authentication_required", "forbidden"] as const)(
    "hides protected job state after %s",
    (code) => {
      expect(memberImportAccessFailure(code)).toMatchObject({
        clearJob: true,
        refreshStatus: false,
        accessMessage: expect.any(String),
      });
    },
  );

  it("refreshes a stale job with a new confirmation operation", () => {
    expect(memberImportApplyFailure("stale_version", "correlation")).toEqual({
      accessMessage: "",
      applyMessage:
        "The import changed. Its current status is being refreshed.",
      clearConfirmation: true,
      clearJob: false,
      refreshStatus: true,
      rotateOperationId: true,
    });
  });

  it("reconciles a lost apply response without rotating the idempotency key", () => {
    expect(memberImportApplyTransportFailure()).toMatchObject({
      clearJob: false,
      refreshStatus: true,
      rotateOperationId: false,
    });
  });

  it("requires fresh confirmation after an apply-time settings requeue", () => {
    expect(memberImportWasRequeuedAfterApply("applying", "uploaded")).toBe(
      true,
    );
    expect(memberImportWasRequeuedAfterApply("uploaded", "validating")).toBe(
      false,
    );
    expect(memberImportWasRequeuedAfterApply("validating", "ready")).toBe(
      false,
    );
    expect(memberImportWasRequeuedAfterApply("applying", "completed")).toBe(
      false,
    );
  });

  it("treats a lost apply response that resolves to ready as a requeue", () => {
    expect(memberImportWasRequeuedAfterApply("applying", "ready")).toBe(true);
  });
});
