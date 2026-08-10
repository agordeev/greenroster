import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  runCreateScoreboardAccessMutation,
  runRevokeScoreboardAccessMutation,
} from "../apps/web/src/lib/scoreboard/scoreboard-access";
import {
  createScoreboardToken,
  scoreboardTokenDigest,
} from "../apps/web/src/lib/scoreboard/scoreboard-token";

const session = {
  userId: "d2100000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-10T00:00:00.000Z",
};

const createInput = {
  roundId: "d2200000-0000-4000-8000-000000000001",
  expiresAt: "2026-08-10T12:00:00.000Z",
  operationId: "d2300000-0000-4000-8000-000000000001",
};

describe("scoreboard access contract", () => {
  it("derives an unguessable versioned token and stores only its digest", () => {
    const token = createScoreboardToken({
      accessId: createInput.operationId,
      secret: "correct horse battery staple scoreboard secret",
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(token).not.toContain(createInput.operationId);
    expect(scoreboardTokenDigest(token)).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      createScoreboardToken({
        accessId: "d2300000-0000-4000-8000-000000000002",
        secret: "correct horse battery staple scoreboard secret",
      }),
    ).not.toBe(token);
  });

  it("binds creation to the verified actor and correlation", async () => {
    const executeCreate = vi.fn().mockResolvedValue({
      accessId: createInput.operationId,
      groupId: "d2400000-0000-4000-8000-000000000001",
      roundId: createInput.roundId,
      state: "active",
      expiresAt: createInput.expiresAt,
      url: "https://greenroster.example/scoreboard/token",
    });
    const response = await runCreateScoreboardAccessMutation(
      createInput,
      "d2500000-0000-4000-8000-000000000001",
      {
        executeCreate,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(response.ok).toBe(true);
    expect(executeCreate).toHaveBeenCalledWith(
      session.userId,
      createInput,
      "d2500000-0000-4000-8000-000000000001",
    );
  });

  it("rejects client-supplied tenant and token fields", async () => {
    const executeCreate = vi.fn();
    const response = await runCreateScoreboardAccessMutation(
      {
        ...createInput,
        groupId: "d2400000-0000-4000-8000-000000000002",
        token: "raw",
      },
      null,
      {
        executeCreate,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(executeCreate).not.toHaveBeenCalled();
  });

  it("binds revocation to the verified actor and keeps the reason required", async () => {
    const executeRevoke = vi.fn().mockResolvedValue({
      accessId: "d2300000-0000-4000-8000-000000000001",
      groupId: "d2400000-0000-4000-8000-000000000001",
      roundId: createInput.roundId,
      state: "revoked",
      expiresAt: createInput.expiresAt,
    });
    const input = {
      accessId: createInput.operationId,
      reason: "No longer on display",
      operationId: "d2600000-0000-4000-8000-000000000001",
    };
    const response = await runRevokeScoreboardAccessMutation(input, null, {
      executeRevoke,
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(response.ok).toBe(true);
    expect(executeRevoke).toHaveBeenCalledWith(
      session.userId,
      input,
      expect.any(String),
    );
  });

  it("keeps the public presentation read-only and free of private scorecard fields", () => {
    const page = readFileSync(
      new URL(
        "../apps/web/src/app/scoreboard/[token]/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const panel = readFileSync(
      new URL(
        "../apps/web/src/app/portal/rounds/scoreboard-access-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(page).toContain('href="#main-content"');
    expect(page).toContain("Live scores");
    expect(page).not.toMatch(/quota|membership|role|email|phone|address/iu);
    expect(panel).toContain("revokeScoreboardAccessAction");
    expect(panel).not.toContain("createScoreboardToken");
  });
});
