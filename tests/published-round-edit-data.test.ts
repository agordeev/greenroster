import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executePreviewPublishedRoundEdit,
  executeUpdatePublishedRoundEdit,
} from "../apps/web/src/lib/rounds/published-round-edit-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "40000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const participantId = "60000000-0000-4000-8000-000000000001";
const membershipId = "70000000-0000-4000-8000-000000000001";
const operationId = "80000000-0000-4000-8000-000000000001";
const correlationId = "90000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);

const current = {
  round_id: roundId,
  group_id: groupId,
  description: "August round",
  scheduled_at: "2026-08-15T13:30:00.000Z",
  group_time_zone: "America/New_York",
  venue: "North Course",
  round_url: "https://example.com/round",
  notes: "Bring a cart.",
  notes_visible_to_players: true,
  rsvp_deadline_at: "2026-08-14T13:30:00.000Z",
  format: "individual_net" as const,
  state: "published" as const,
  version: 2,
};

const proposed = {
  ...current,
  description: "Updated August round",
  version: 2,
};

const participant = {
  participant_id: participantId,
  membership_id: membershipId,
  first_name: "Alex",
  last_name: "Golfer",
  rsvp_status: "playing" as const,
};

const previewEnvelope = {
  current,
  proposed,
  current_version: "2",
  changed_fields: ["description"],
  material_categories: [],
  affected_participants: [participant],
  affected_participant_count: "1",
  scoring_consequences: ["Immutable participant snapshots remain unchanged."],
  impact_fingerprint: fingerprint,
};

const previewInput = {
  roundId,
  description: "Updated August round",
  scheduledLocal: "2026-08-15T09:30",
  venue: "North Course",
  roundUrl: "https://example.com/round",
  notes: "Bring a cart.",
  notesVisibleToPlayers: true,
  rsvpDeadlineLocal: "2026-08-14T09:30",
  expectedRoundVersion: 2,
};

const updateInput = {
  ...previewInput,
  impactFingerprint: fingerprint,
  announce: true,
  operationId,
};

describe("published round edit RPC adapter", () => {
  it("maps the strict preview envelope and local fields", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: previewEnvelope, error: null });

    await expect(
      executePreviewPublishedRoundEdit(actorUserId, previewInput),
    ).resolves.toEqual({
      current: expect.objectContaining({
        roundId,
        description: current.description,
        format: "individual_net",
      }),
      proposed: expect.objectContaining({ description: proposed.description }),
      currentVersion: 2,
      changedFields: ["description"],
      materialCategories: [],
      affectedParticipants: [
        expect.objectContaining({ participantId, membershipId }),
      ],
      affectedParticipantCount: 1,
      scoringConsequences: [
        "Immutable participant snapshots remain unchanged.",
      ],
      impactFingerprint: fingerprint,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("preview_published_round_edit", {
      p_actor_user_id: actorUserId,
      p_round_id: roundId,
      p_description: updateInput.description,
      p_scheduled_local: updateInput.scheduledLocal,
      p_venue: updateInput.venue,
      p_round_url: updateInput.roundUrl,
      p_notes: updateInput.notes,
      p_notes_visible_to_players: true,
      p_rsvp_deadline_local: updateInput.rsvpDeadlineLocal,
      p_expected_round_version: 2,
    });
  });

  it("maps the apply receipt and forwards idempotency and announcement", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...previewEnvelope,
        current_version: 3,
        announce: true,
        notification_count: "1",
      },
      error: null,
    });

    await expect(
      executeUpdatePublishedRoundEdit(actorUserId, updateInput, correlationId),
    ).resolves.toMatchObject({
      currentVersion: 3,
      announce: true,
      notificationCount: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_published_round_edit", {
      p_actor_user_id: actorUserId,
      p_round_id: roundId,
      p_description: updateInput.description,
      p_scheduled_local: updateInput.scheduledLocal,
      p_venue: updateInput.venue,
      p_round_url: updateInput.roundUrl,
      p_notes: updateInput.notes,
      p_notes_visible_to_players: true,
      p_rsvp_deadline_local: updateInput.rsvpDeadlineLocal,
      p_expected_round_version: 2,
      p_impact_fingerprint: fingerprint,
      p_announce: true,
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });

  it.each([
    ["P0003", "forbidden"],
    ["P0002", "unavailable"],
    ["P0001", "locked"],
    ["40001", "stale_version"],
    ["22023", "validation"],
    ["23505", "operation_reused"],
  ] as const)("maps %s RPC errors safely", async (code, mappedCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code, message: "server_error" },
    });
    await expect(
      executeUpdatePublishedRoundEdit(actorUserId, updateInput, correlationId),
    ).rejects.toMatchObject({ code: mappedCode });
  });

  it("fails closed for an unrecognized envelope", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...previewEnvelope, unexpected: true },
      error: null,
    });
    await expect(
      executePreviewPublishedRoundEdit(actorUserId, previewInput),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
