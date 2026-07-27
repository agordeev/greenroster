import { describe, expect, it } from "vitest";

import {
  getMobileMutationRetryContext,
  isMobileSelfProfileDraftDirty,
  mobileSelfProfileDraftFingerprint,
  normalizeMobileSelfProfileDraft,
} from "../apps/mobile/src/lib/profile/mobile-self-profile-state";

const completeDraft = {
  firstName: " Alice ",
  lastName: " Admin ",
  spouseFirstName: " Pat ",
  spouseLastName: " Admin ",
  teeLocation: "MIDDLE",
  secondaryEmail: " ALICE@example.com ",
  homePhone: " (555) 100-1000 ",
  workPhone: "",
  mobilePhone: "+15551001001",
  addressLine1: " 1 Main Street ",
  addressLine2: "",
  city: " Fairway ",
  stateRegion: " CA ",
  postalCode: " 90210 ",
  country: " US ",
  secondaryEmailVisible: true,
  homePhoneVisible: false,
  workPhoneVisible: false,
  mobilePhoneVisible: true,
  addressListed: false,
} as const;

describe("mobile self-profile draft state", () => {
  it("normalizes whitespace, empty optional values, tee, and e-mail", () => {
    expect(normalizeMobileSelfProfileDraft(completeDraft)).toEqual({
      firstName: "Alice",
      lastName: "Admin",
      spouseFirstName: "Pat",
      spouseLastName: "Admin",
      teeLocation: "middle",
      secondaryEmail: "alice@example.com",
      homePhone: "(555) 100-1000",
      workPhone: null,
      mobilePhone: "+15551001001",
      addressLine1: "1 Main Street",
      addressLine2: null,
      city: "Fairway",
      stateRegion: "CA",
      postalCode: "90210",
      country: "US",
      secondaryEmailVisible: true,
      homePhoneVisible: false,
      workPhoneVisible: false,
      mobilePhoneVisible: true,
      addressListed: false,
    });
  });

  it("detects only semantic draft changes", () => {
    const initial = normalizeMobileSelfProfileDraft(completeDraft);
    const whitespaceOnly = normalizeMobileSelfProfileDraft({
      ...completeDraft,
      firstName: "Alice",
      secondaryEmail: "alice@example.com",
    });
    expect(isMobileSelfProfileDraftDirty(initial, whitespaceOnly)).toBe(false);
    expect(
      isMobileSelfProfileDraftDirty(initial, {
        ...initial,
        addressListed: true,
      }),
    ).toBe(true);
    expect(mobileSelfProfileDraftFingerprint(initial)).toContain("Alice");
  });

  it("reuses an operation context only for the unchanged semantic action", () => {
    const createContext = () => ({ correlationId: "c1", operationId: "o1" });
    const first = getMobileMutationRetryContext(
      null,
      "profile-a",
      createContext,
    );
    const retry = getMobileMutationRetryContext(first, "profile-a", () => ({
      correlationId: "c2",
      operationId: "o2",
    }));
    const changed = getMobileMutationRetryContext(
      retry,
      "profile-a-v2",
      () => ({
        correlationId: "c3",
        operationId: "o3",
      }),
    );
    expect(retry).toBe(first);
    expect(changed).toMatchObject({
      correlationId: "c3",
      operationId: "o3",
      fingerprint: "profile-a-v2",
    });
  });
});
