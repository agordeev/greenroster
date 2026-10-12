"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createRoundGuestAction,
  updateRoundGuestAction,
  withdrawRoundGuestAction,
} from "@/app/actions/rounds";
import { EmptyState, FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  RoundCoordinatorParticipant,
  RoundCoordinatorParticipantRsvpState,
} from "@/domain/round-detail";
import type { RoundFormat, RoundState } from "@/domain/round-drafts";

type GuestParticipant = RoundCoordinatorParticipant & {
  participantKind: "guest";
};

type MemberParticipant = RoundCoordinatorParticipant & {
  participantKind: "member";
};

export function RoundGuestPanel({
  format,
  participants,
  roundId,
  state,
}: Readonly<{
  format: RoundFormat | null;
  participants: readonly RoundCoordinatorParticipant[];
  roundId: string;
  state: Extract<RoundState, "published" | "live">;
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [quota, setQuota] = useState("");
  const [handicap, setHandicap] = useState("");
  const [tee, setTee] = useState("");
  const [sponsorMembershipId, setSponsorMembershipId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");

  const guests = useMemo(
    () =>
      participants.filter(
        (participant): participant is GuestParticipant =>
          participant.participantKind === "guest",
      ),
    [participants],
  );
  const sponsors = useMemo(
    () =>
      participants.filter(
        (participant): participant is MemberParticipant =>
          participant.participantKind === "member" &&
          participant.membershipId !== null &&
          participant.rsvpStatus === "playing",
      ),
    [participants],
  );
  const quotaRequired = format === "individual_net";

  function addGuest() {
    setMessage("");
    setMessageTone("");
    startTransition(async () => {
      const result = await createRoundGuestAction({
        roundId,
        sponsorMembershipId: sponsorMembershipId || null,
        firstName,
        lastName,
        quotaSnapshot: quota.trim() || null,
        handicapSnapshot: handicap.trim() || null,
        teeSnapshot: tee || null,
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        return;
      }
      setFirstName("");
      setLastName("");
      setQuota("");
      setHandicap("");
      setTee("");
      setMessage(
        result.data.duplicateLike
          ? "Guest added. Another guest has the same name."
          : "Guest added to the round.",
      );
      setMessageTone(result.data.duplicateLike ? "error" : "success");
      router.refresh();
    });
  }

  return (
    <section className="page-section" aria-labelledby="round-guests-title">
      <SectionHeading
        kicker="Guests"
        title="Guests"
        titleId="round-guests-title"
        meta={state === "live" ? "Live round" : "Published round"}
      />
      <p>Add a guest to this round.</p>

      {guests.length > 0 ? (
        <div className="round-detail-table-wrap">
          <table>
            <caption className="visually-hidden">Round guests</caption>
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">RSVP</th>
                <th scope="col">Quota</th>
                <th scope="col">Handicap</th>
                <th scope="col">Tee</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((guest) => (
                <GuestRow
                  key={guest.participantId}
                  guest={guest}
                  onDone={router.refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No guests in this round yet.</EmptyState>
      )}

      <div className="form-row">
        <div className="field-group">
          <label htmlFor="round-guest-first-name">Guest first name</label>
          <Input
            id="round-guest-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-last-name">Guest last name</label>
          <Input
            id="round-guest-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-sponsor">Sponsor</label>
          <NativeSelect
            id="round-guest-sponsor"
            value={sponsorMembershipId}
            onChange={(event) => setSponsorMembershipId(event.target.value)}
            disabled={pending}
          >
            <option value="">You (if you’re playing)</option>
            {sponsors.map((sponsor) => (
              <option
                key={sponsor.membershipId}
                value={sponsor.membershipId ?? ""}
              >
                {displayName(sponsor)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-quota">
            Quota{quotaRequired ? " (required)" : ""}
          </label>
          <Input
            id="round-guest-quota"
            inputMode="decimal"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-handicap">Handicap</label>
          <Input
            id="round-guest-handicap"
            inputMode="decimal"
            value={handicap}
            onChange={(event) => setHandicap(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-tee">Tee</label>
          <NativeSelect
            id="round-guest-tee"
            value={tee}
            onChange={(event) => setTee(event.target.value)}
            disabled={pending}
          >
            <option value="">Choose a tee</option>
            <option value="pro">Pro</option>
            <option value="back">Back</option>
            <option value="middle">Middle</option>
            <option value="front">Front</option>
          </NativeSelect>
        </div>
      </div>
      <p className="field-help">
        {quotaRequired
          ? "Enter a quota before you add a guest to this net round."
          : "You can leave quota blank for this gross round."}
      </p>
      <FormMessage
        tone={messageTone === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </FormMessage>
      <Button
        type="button"
        onClick={addGuest}
        disabled={
          pending ||
          !firstName.trim() ||
          !lastName.trim() ||
          (quotaRequired && !quota.trim())
        }
      >
        {pending ? "Adding guest…" : "Add guest"}
      </Button>
    </section>
  );
}

function GuestRow({
  guest,
  onDone,
}: Readonly<{ guest: GuestParticipant; onDone: () => void }>) {
  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState(guest.firstName ?? "");
  const [lastName, setLastName] = useState(guest.lastName ?? "");
  const [quota, setQuota] = useState(guest.quotaSnapshot ?? "");
  const [handicap, setHandicap] = useState(guest.handicapSnapshot ?? "");
  const [tee, setTee] = useState(guest.teeSnapshot ?? "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  function updateGuest() {
    startTransition(async () => {
      const result = await updateRoundGuestAction({
        participantId: guest.participantId,
        firstName,
        lastName,
        quotaSnapshot: quota.trim() || null,
        handicapSnapshot: handicap.trim() || null,
        teeSnapshot: tee || null,
        expectedParticipantVersion: guest.version,
        reason: reason.trim() || null,
        operationId: crypto.randomUUID(),
      });
      setMessage(result.ok ? "Guest saved." : result.error.message);
      if (result.ok) onDone();
    });
  }

  function withdrawGuest() {
    if (!reason.trim()) {
      setMessage("Add a reason before you withdraw this guest.");
      return;
    }
    if (!window.confirm("Withdraw this guest from this round?")) return;
    startTransition(async () => {
      const result = await withdrawRoundGuestAction({
        roundId: guest.roundId,
        participantId: guest.participantId,
        expectedParticipantVersion: guest.version,
        confirmed: true,
        reason,
        operationId: crypto.randomUUID(),
      });
      setMessage(result.ok ? "Guest withdrawn." : result.error.message);
      if (result.ok) onDone();
    });
  }

  return (
    <tr>
      <th scope="row">
        <Input
          aria-label="Guest first name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          disabled={pending}
        />
        <Input
          aria-label="Guest last name"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          disabled={pending}
        />
      </th>
      <td>
        {formatRsvp(guest.rsvpStatus)}
        <small>{message}</small>
      </td>
      <td>
        <Input
          aria-label="Guest quota"
          inputMode="decimal"
          value={quota}
          onChange={(event) => setQuota(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <Input
          aria-label="Guest handicap"
          inputMode="decimal"
          value={handicap}
          onChange={(event) => setHandicap(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <NativeSelect
          aria-label="Guest tee"
          value={tee}
          onChange={(event) => setTee(event.target.value)}
          disabled={pending}
        >
          <option value="">—</option>
          <option value="pro">Pro</option>
          <option value="back">Back</option>
          <option value="middle">Middle</option>
          <option value="front">Front</option>
        </NativeSelect>
        <Input
          aria-label="Reason for guest change"
          placeholder="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <Button
          variant="outline"
          type="button"
          onClick={updateGuest}
          disabled={pending}
        >
          Save
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={withdrawGuest}
          disabled={pending || guest.rsvpStatus === "not_playing"}
        >
          Withdraw
        </Button>
      </td>
    </tr>
  );
}

function displayName(participant: RoundCoordinatorParticipant): string {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(" ") ||
    "Unnamed player"
  );
}

function formatRsvp(status: RoundCoordinatorParticipantRsvpState): string {
  return status === "playing"
    ? "Playing"
    : status === "not_playing"
      ? "Not playing"
      : "No response";
}
