"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createRoundGuestAction,
  updateRoundGuestAction,
  withdrawRoundGuestAction,
} from "@/app/actions/rounds";
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
          ? "You add this guest, and another guest has the same name."
          : "You add this guest to the round.",
      );
      setMessageTone(result.data.duplicateLike ? "error" : "success");
      router.refresh();
    });
  }

  return (
    <section className="group-roles-panel" aria-labelledby="round-guests-title">
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Guest management</p>
          <h2 id="round-guests-title">Guests</h2>
        </div>
        <p>{state === "live" ? "Live round" : "Published round"}</p>
      </div>
      <p>
        You add a guest for this round with the sponsor, quota, handicap, and
        tee values that you want the server to use.
      </p>

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
        <p className="group-empty" role="status">
          You have no guests in this round.
        </p>
      )}

      <div className="group-profile-fields">
        <div className="field-group">
          <label htmlFor="round-guest-first-name">Guest first name</label>
          <input
            id="round-guest-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-last-name">Guest last name</label>
          <input
            id="round-guest-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-sponsor">Sponsor</label>
          <select
            id="round-guest-sponsor"
            value={sponsorMembershipId}
            onChange={(event) => setSponsorMembershipId(event.target.value)}
            disabled={pending}
          >
            <option value="">Use your playing membership</option>
            {sponsors.map((sponsor) => (
              <option
                key={sponsor.membershipId}
                value={sponsor.membershipId ?? ""}
              >
                {displayName(sponsor)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-quota">
            Quota{quotaRequired ? " (required)" : ""}
          </label>
          <input
            id="round-guest-quota"
            inputMode="decimal"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-handicap">Handicap</label>
          <input
            id="round-guest-handicap"
            inputMode="decimal"
            value={handicap}
            onChange={(event) => setHandicap(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field-group">
          <label htmlFor="round-guest-tee">Tee</label>
          <select
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
          </select>
        </div>
      </div>
      <p className="field-help">
        {quotaRequired
          ? "You enter a quota before you add a guest to this net round."
          : "You can leave quota blank for this gross round."}
      </p>
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <button
        className="primary-button"
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
      </button>
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
      setMessage(result.ok ? "You save this guest." : result.error.message);
      if (result.ok) onDone();
    });
  }

  function withdrawGuest() {
    if (!reason.trim()) {
      setMessage("You enter a reason before you withdraw this guest.");
      return;
    }
    if (!window.confirm("You withdraw this guest from this round.")) return;
    startTransition(async () => {
      const result = await withdrawRoundGuestAction({
        roundId: guest.roundId,
        participantId: guest.participantId,
        expectedParticipantVersion: guest.version,
        confirmed: true,
        reason,
        operationId: crypto.randomUUID(),
      });
      setMessage(result.ok ? "You withdraw this guest." : result.error.message);
      if (result.ok) onDone();
    });
  }

  return (
    <tr>
      <th scope="row">
        <input
          aria-label="Guest first name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          disabled={pending}
        />
        <input
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
        <input
          aria-label="Guest quota"
          inputMode="decimal"
          value={quota}
          onChange={(event) => setQuota(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <input
          aria-label="Guest handicap"
          inputMode="decimal"
          value={handicap}
          onChange={(event) => setHandicap(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <select
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
        </select>
        <input
          aria-label="Reason for guest change"
          placeholder="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
        />
      </td>
      <td>
        <button
          className="secondary-button"
          type="button"
          onClick={updateGuest}
          disabled={pending}
        >
          Save
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={withdrawGuest}
          disabled={pending || guest.rsvpStatus === "not_playing"}
        >
          Withdraw
        </button>
      </td>
    </tr>
  );
}

function displayName(participant: RoundCoordinatorParticipant): string {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(" ") ||
    "Unnamed member"
  );
}

function formatRsvp(status: RoundCoordinatorParticipantRsvpState): string {
  return status === "playing"
    ? "Playing"
    : status === "not_playing"
      ? "Not playing"
      : "No response";
}
