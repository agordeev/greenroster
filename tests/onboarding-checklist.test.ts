import { describe, expect, it } from "vitest";

import { buildOnboardingChecklist } from "../apps/web/src/lib/groups/onboarding-checklist";

describe("group onboarding checklist", () => {
  it("derives group and membership completion from authoritative state", () => {
    const checklist = buildOnboardingChecklist(true, 2);

    expect(checklist.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: "group-profile", status: "complete" },
      { key: "rules", status: "not-configured" },
      { key: "members", status: "complete" },
      { key: "first-round", status: "not-configured" },
    ]);
    expect(checklist[2]?.detail).toContain("2 additional memberships");
  });

  it("never treats missing stored records as local completion", () => {
    const checklist = buildOnboardingChecklist(false, 0);

    expect(checklist.every((item) => item.status === "not-configured")).toBe(
      true,
    );
    expect(checklist.some((item) => "dismissed" in item)).toBe(false);
  });

  it("uses singular membership copy for one additional person", () => {
    expect(buildOnboardingChecklist(true, 1)[2]?.detail).toContain(
      "1 additional membership is",
    );
  });
});
