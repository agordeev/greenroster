import { describe, expect, it, vi } from "vitest";

import { runMemberImportWorker } from "../apps/web/src/lib/member-imports/member-import-worker";

const jobId = "30000000-0000-4000-8000-000000000001";
const groupId = "30000000-0000-4000-8000-000000000002";
const workerId = "30000000-0000-4000-8000-000000000003";
const actorId = "30000000-0000-4000-8000-000000000004";
const operationId = "30000000-0000-4000-8000-000000000005";
const invitationId = "30000000-0000-4000-8000-000000000006";
const correlationId = "30000000-0000-4000-8000-000000000007";

function result(data: unknown) {
  return Promise.resolve({ data, error: null });
}

describe("member import worker", () => {
  it("claims, validates, and finalizes one uploaded job", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "claim_next_member_csv_import") {
        return result([
          {
            claimed_job_id: jobId,
            claimed_state: "validating",
            group_id: groupId,
            revision: 2,
            lease_expires_at: "2026-07-27T12:30:00.000Z",
          },
        ]);
      }
      if (name === "validate_member_csv_import") return result([{ ok: true }]);
      if (name === "finalize_member_csv_import_validation") {
        return result([{ finalized_job_id: jobId, state: "ready" }]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const createId = vi
      .fn()
      .mockReturnValueOnce(workerId)
      .mockReturnValueOnce(correlationId);
    await expect(
      runMemberImportWorker({
        createClient: () => ({ rpc }),
        createId,
        getConfig: () => ({ tokenSecret: "unused", ttlMilliseconds: 1000 }),
      }),
    ).resolves.toEqual({ kind: "ready", jobId });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_next_member_csv_import",
      "validate_member_csv_import",
      "finalize_member_csv_import_validation",
    ]);
  });

  it("creates secret-independent invitation payloads and atomically applies a confirmed job", async () => {
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "claim_next_member_csv_import") {
        return result([
          {
            claimed_job_id: jobId,
            claimed_state: "applying",
            group_id: groupId,
            revision: 4,
            lease_expires_at: "2026-07-27T12:30:00.000Z",
          },
        ]);
      }
      if (name === "get_member_csv_import_apply_material") {
        return result([
          {
            import_job_id: jobId,
            row_number: 2,
            invited_email: "Member@Example.test",
            invited_email_normalized: "member@example.test",
            apply_confirmed_by: actorId,
            apply_operation_id: operationId,
            revision: 4,
          },
        ]);
      }
      if (name === "apply_member_csv_import") {
        const payloads = args.p_invitation_payloads as Array<
          Record<string, unknown>
        >;
        expect(payloads).toEqual([
          expect.objectContaining({
            row_number: 2,
            invitation_id: invitationId,
            invited_email: "Member@Example.test",
            token_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
            token_key_version: 1,
            expires_at: "2026-07-29T12:00:00.000Z",
          }),
        ]);
        expect(JSON.stringify(payloads)).not.toContain("rawToken");
        expect(args).toMatchObject({
          p_actor_user_id: actorId,
          p_operation_id: operationId,
          p_worker_id: workerId,
        });
        return result([
          {
            import_job_id: jobId,
            state: "completed",
            applied_rows: 1,
            skipped_rows: 0,
          },
        ]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const ids = [workerId, invitationId, correlationId];
    await expect(
      runMemberImportWorker({
        createClient: () => ({ rpc }),
        createId: () => ids.shift() ?? crypto.randomUUID(),
        getConfig: () => ({
          tokenSecret: "0123456789abcdef0123456789abcdef",
          ttlMilliseconds: 48 * 60 * 60 * 1000,
        }),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      kind: "completed",
      jobId,
      appliedRows: 1,
      skippedRows: 0,
    });
  });

  it("reports settings-drift requeues without fabricating completion", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "claim_next_member_csv_import") {
        return result([
          {
            claimed_job_id: jobId,
            claimed_state: "applying",
            group_id: groupId,
            revision: 4,
            lease_expires_at: "2026-07-27T12:30:00.000Z",
          },
        ]);
      }
      if (name === "get_member_csv_import_apply_material") {
        return result([
          {
            import_job_id: jobId,
            row_number: 2,
            invited_email: "Member@Example.test",
            invited_email_normalized: "member@example.test",
            apply_confirmed_by: actorId,
            apply_operation_id: operationId,
            revision: 4,
          },
        ]);
      }
      if (name === "apply_member_csv_import") {
        return result([
          {
            import_job_id: jobId,
            state: "uploaded",
            applied_rows: 0,
            skipped_rows: 0,
          },
        ]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(
      runMemberImportWorker({
        createClient: () => ({ rpc }),
        createId: () => crypto.randomUUID(),
        getConfig: () => ({
          tokenSecret: "0123456789abcdef0123456789abcdef",
          ttlMilliseconds: 48 * 60 * 60 * 1000,
        }),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "requeued", jobId });
  });

  it("returns empty and unavailable without fabricating progress", async () => {
    await expect(
      runMemberImportWorker({
        createClient: () => ({ rpc: () => result([]) }),
        createId: () => workerId,
        getConfig: () => ({ tokenSecret: "unused", ttlMilliseconds: 1000 }),
      }),
    ).resolves.toEqual({ kind: "empty" });
    await expect(
      runMemberImportWorker({
        createClient: () => ({
          rpc: () => Promise.resolve({ data: null, error: { code: "failed" } }),
        }),
        createId: () => workerId,
        getConfig: () => ({ tokenSecret: "unused", ttlMilliseconds: 1000 }),
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});
