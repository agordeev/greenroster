import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileFirstRunApi } from "../apps/mobile/src/lib/profile/mobile-first-run-api";

type FirstRunClient = Parameters<typeof createMobileFirstRunApi>[0];

const incompleteRow = {
  accepted_privacy_at: null,
  accepted_terms_at: null,
  current_privacy_version: "privacy-v2",
  current_terms_version: "terms-v3",
  first_name: null,
  is_complete: false,
  last_name: null,
};

describe("mobile first-run API", () => {
  let rpc: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createMobileFirstRunApi>;

  beforeEach(() => {
    rpc = vi.fn();
    api = createMobileFirstRunApi({ rpc } as unknown as FirstRunClient);
  });

  const observedVersions = {
    privacyVersion: "privacy-v2",
    termsVersion: "terms-v3",
  };

  it("maps the server-owned profile and current legal versions", async () => {
    rpc.mockResolvedValue({ data: [incompleteRow], error: null });

    await expect(api.resolve()).resolves.toEqual({
      ok: true,
      state: {
        acceptedPrivacyAt: null,
        acceptedTermsAt: null,
        currentPrivacyVersion: "privacy-v2",
        currentTermsVersion: "terms-v3",
        firstName: "",
        isComplete: false,
        lastName: "",
      },
    });
    expect(rpc).toHaveBeenCalledWith("resolve_mobile_first_run");
  });

  it("treats a missing active membership as permission denied", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
  });

  it("fails closed when legal document configuration is absent", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "legal_document_versions_unavailable" },
    });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "configuration_unavailable",
      ok: false,
    });
  });

  it("validates names before sending a mutation", async () => {
    await expect(
      api.complete(" ", "Member", observedVersions),
    ).resolves.toMatchObject({
      code: "validation",
      field: "firstName",
      ok: false,
    });
    await expect(
      api.complete("Member", " ", observedVersions),
    ).resolves.toMatchObject({
      code: "validation",
      field: "lastName",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends stable operation context and observed legal preconditions", async () => {
    rpc
      .mockResolvedValueOnce({ data: [{}], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            ...incompleteRow,
            accepted_privacy_at: "2026-07-26T01:00:00Z",
            accepted_terms_at: "2026-07-26T01:00:00Z",
            first_name: "Alice",
            is_complete: true,
            last_name: "Admin",
          },
        ],
        error: null,
      });

    await expect(
      api.complete("  Alice ", " Admin  ", observedVersions, {
        correlationId: "40000000-0000-4000-8000-000000000010",
        operationId: "40000000-0000-4000-8000-000000000011",
      }),
    ).resolves.toMatchObject({ ok: true, state: { isComplete: true } });
    expect(rpc).toHaveBeenNthCalledWith(1, "complete_mobile_first_run", {
      p_correlation_id: "40000000-0000-4000-8000-000000000010",
      p_first_name: "Alice",
      p_last_name: "Admin",
      p_operation_id: "40000000-0000-4000-8000-000000000011",
      p_privacy_version: "privacy-v2",
      p_terms_version: "terms-v3",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "resolve_mobile_first_run");
  });

  it("maps revocation races and transport failures safely", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "identity_context_unavailable" },
      })
      .mockRejectedValueOnce(new Error("provider details"));

    await expect(
      api.complete("Alice", "Admin", observedVersions),
    ).resolves.toMatchObject({
      code: "permission_denied",
      ok: false,
    });
    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("requires review again when the configured legal versions changed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "legal_document_versions_changed" },
    });

    await expect(
      api.complete("Alice", "Admin", observedVersions),
    ).resolves.toMatchObject({
      code: "legal_documents_changed",
      ok: false,
    });
  });

  it("rejects malformed server projections", async () => {
    rpc.mockResolvedValue({ data: [{ is_complete: true }], error: null });

    await expect(api.resolve()).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });
});
