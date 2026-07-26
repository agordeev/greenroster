import { describe, expect, it } from "vitest";

import {
  MOBILE_AUTH_CALLBACK_URL,
  parseMobileAuthCallback,
} from "../apps/mobile/src/lib/auth/mobile-auth-callback";
import { createChunkedSessionStorage } from "../apps/mobile/src/lib/auth/chunked-session-storage";
import {
  mobileAuthStateForEvent,
  restoredMobileAuthState,
} from "../apps/mobile/src/lib/auth/mobile-auth-state";
import type { Session } from "@supabase/supabase-js";

describe("mobile authentication callback", () => {
  it("accepts only the exact application callback with a code", () => {
    expect(
      parseMobileAuthCallback(
        `${MOBILE_AUTH_CALLBACK_URL}?code=pkce-code&recovery_state=40000000-0000-4000-8000-000000000101`,
      ),
    ).toEqual({
      kind: "code",
      code: "pkce-code",
      recoveryState: "40000000-0000-4000-8000-000000000101",
    });
  });

  it("rejects external, lookalike, and malformed callback locations", () => {
    expect(
      parseMobileAuthCallback(
        "https://attacker.example/auth/callback?code=stolen",
      ),
    ).toEqual({
      kind: "ignored",
    });
    expect(
      parseMobileAuthCallback("greenroster://attacker/callback?code=stolen"),
    ).toEqual({
      kind: "ignored",
    });
    expect(parseMobileAuthCallback("not a url")).toEqual({ kind: "ignored" });
  });

  it("returns a generic error without exposing provider details", () => {
    expect(
      parseMobileAuthCallback(
        `${MOBILE_AUTH_CALLBACK_URL}?error=access_denied&error_description=sensitive`,
      ),
    ).toEqual({ kind: "error" });
    expect(parseMobileAuthCallback(MOBILE_AUTH_CALLBACK_URL)).toEqual({
      kind: "error",
    });
  });
});

describe("mobile secure session storage", () => {
  function createMemoryDriver() {
    const values = new Map<string, string>();

    return {
      driver: {
        async getItem(key: string) {
          return values.get(key) ?? null;
        },
        async removeItem(key: string) {
          values.delete(key);
        },
        async setItem(key: string, value: string) {
          values.set(key, value);
        },
      },
      values,
    };
  }

  it("round-trips a session across encrypted-size chunks", async () => {
    const { driver, values } = createMemoryDriver();
    const storage = createChunkedSessionStorage(driver, {
      chunkSize: 4,
      createVersion: () => "version-1",
    });

    await storage.setItem("session", "abcdefghijkl");

    expect(await storage.getItem("session")).toBe("abcdefghijkl");
    expect(values.get("session.meta")).toBe(
      JSON.stringify({
        active: { chunkCount: 3, version: "version-1" },
        cleanupLegacy: false,
        stale: [],
      }),
    );
  });

  it("retains stale chunk metadata until failed cleanup can be retried", async () => {
    const { driver, values } = createMemoryDriver();
    let version = 0;
    let rejectOldChunkOnce = false;
    const storage = createChunkedSessionStorage(
      {
        ...driver,
        async removeItem(key: string) {
          if (rejectOldChunkOnce && key.includes("version-1")) {
            rejectOldChunkOnce = false;
            throw new Error("injected cleanup failure");
          }
          await driver.removeItem(key);
        },
      },
      {
        chunkSize: 3,
        createVersion: () => `version-${++version}`,
      },
    );

    await storage.setItem("session", "first-value");
    rejectOldChunkOnce = true;
    await expect(storage.setItem("session", "next")).resolves.toBeUndefined();

    expect(await storage.getItem("session")).toBe("next");
    expect([...values.keys()].some((key) => key.includes("version-1"))).toBe(
      false,
    );
    expect(values.get("session.meta")).not.toContain("version-1");
  });

  it("journals partial new chunks before the active session is committed", async () => {
    const { driver, values } = createMemoryDriver();
    let version = 0;
    let rejectNewChunkOnce = false;
    const storage = createChunkedSessionStorage(
      {
        ...driver,
        async setItem(key: string, value: string) {
          if (
            rejectNewChunkOnce &&
            key.includes("version-2") &&
            key.endsWith(".1")
          ) {
            rejectNewChunkOnce = false;
            throw new Error("injected chunk failure");
          }
          await driver.setItem(key, value);
        },
      },
      {
        chunkSize: 3,
        createVersion: () => `version-${++version}`,
      },
    );

    await storage.setItem("session", "first-value");
    rejectNewChunkOnce = true;

    await expect(storage.setItem("session", "next-value")).rejects.toThrow(
      "injected chunk failure",
    );
    expect(values.get("session.pending")).toContain("version-2");
    expect(await storage.getItem("session")).toBe("first-value");
    expect([...values.keys()].some((key) => key.includes("version-2"))).toBe(
      false,
    );
    expect(values.has("session.pending")).toBe(false);
  });

  it("waits for delayed sibling writes before exposing a failed chunk write", async () => {
    const { driver, values } = createMemoryDriver();
    let version = 0;
    let releaseDelayedWrite: (() => void) | undefined;
    const delayedWrite = new Promise<void>((resolve) => {
      releaseDelayedWrite = resolve;
    });
    const storage = createChunkedSessionStorage(
      {
        ...driver,
        async setItem(key: string, value: string) {
          if (key.includes("version-2") && key.endsWith(".1")) {
            throw new Error("injected chunk failure");
          }
          if (key.includes("version-2") && key.endsWith(".2")) {
            await delayedWrite;
          }
          await driver.setItem(key, value);
        },
      },
      {
        chunkSize: 3,
        createVersion: () => `version-${++version}`,
      },
    );

    await storage.setItem("session", "first-value");
    const replacement = storage.setItem("session", "next-value");
    let replacementSettled = false;
    void replacement.catch(() => {
      replacementSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(replacementSettled).toBe(false);
    releaseDelayedWrite?.();
    await expect(replacement).rejects.toThrow("injected chunk failure");
    expect(await storage.getItem("session")).toBe("first-value");
    expect([...values.keys()].some((key) => key.includes("version-2"))).toBe(
      false,
    );
    expect(values.has("session.pending")).toBe(false);
  });

  it("publishes replacement metadata before removing prior chunks", async () => {
    const { driver, values } = createMemoryDriver();
    let version = 0;
    const storage = createChunkedSessionStorage(driver, {
      chunkSize: 3,
      createVersion: () => `version-${++version}`,
    });

    await storage.setItem("session", "first-value");
    await storage.setItem("session", "next");

    expect(await storage.getItem("session")).toBe("next");
    expect([...values.keys()].some((key) => key.includes("version-1"))).toBe(
      false,
    );
  });

  it("removes chunked and legacy session values", async () => {
    const { driver, values } = createMemoryDriver();
    const storage = createChunkedSessionStorage(driver, {
      chunkSize: 3,
      createVersion: () => "version-1",
    });

    values.set("legacy", "old-session");
    expect(await storage.getItem("legacy")).toBe("old-session");

    await storage.setItem("session", "secret-session");
    await storage.removeItem("session");
    await storage.removeItem("legacy");

    expect(await storage.getItem("session")).toBeNull();
    expect(await storage.getItem("legacy")).toBeNull();
    expect(values.size).toBe(0);
  });
});

describe("mobile recovery-only session state", () => {
  const session = { access_token: "token" } as Session;

  it("restores a persisted recovery gate with its session", () => {
    expect(restoredMobileAuthState(session, true)).toMatchObject({
      recoveryRequired: true,
      session,
      status: "signed-in",
    });
    expect(restoredMobileAuthState(null, true)).toMatchObject({
      recoveryRequired: false,
      session: null,
      status: "signed-out",
    });
  });

  it("preserves recovery-only access across refresh and user events", () => {
    const recoveryState = mobileAuthStateForEvent(
      restoredMobileAuthState(session, false),
      "PASSWORD_RECOVERY",
      session,
    );

    expect(
      mobileAuthStateForEvent(recoveryState, "TOKEN_REFRESHED", session)
        .recoveryRequired,
    ).toBe(true);
    expect(
      mobileAuthStateForEvent(recoveryState, "USER_UPDATED", session)
        .recoveryRequired,
    ).toBe(true);
    expect(
      mobileAuthStateForEvent(recoveryState, "SIGNED_OUT", null)
        .recoveryRequired,
    ).toBe(false);
  });
});
