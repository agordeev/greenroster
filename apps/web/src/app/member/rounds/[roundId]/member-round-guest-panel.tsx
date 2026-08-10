"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createMemberRoundGuestAction,
  updateMemberRoundGuestAction,
  withdrawMemberRoundGuestAction,
} from "@/app/actions/rounds";
import type {
  MemberRoundGuest,
  MemberRoundGuestContext,
} from "@/domain/member-round-detail";

export function MemberRoundGuestPanel({
  context,
}: Readonly<{ context: MemberRoundGuestContext }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [quota, setQuota] = useState("");
  const [handicap, setHandicap] = useState("");
  const [tee, setTee] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const quotaRequired = context.format === "individual_net";

  function addGuest() {
    setMessage("");
    setMessageTone("");
    startTransition(async () => {
      const result = await createMemberRoundGuestAction({
        roundId: context.roundId,
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
    <section
      className="group-roles-panel"
      aria-labelledby="member-guests-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Guests</p>
          <h2 id="member-guests-title">Guests for you</h2>
        </div>
        <p>{context.guests.length} added</p>
      </div>
      <p>
        You add a guest when your group lets members add guests to a published
        round.
      </p>

      {context.guests.length > 0 ? (
        <div className="round-detail-table-wrap">
          <table>
            <caption className="visually-hidden">Your round guests</caption>
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Response</th>
                <th scope="col">Quota</th>
                <th scope="col">Handicap</th>
                <th scope="col">Tee</th>
                {context.canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {context.guests.map((guest) => (
                <GuestRow
                  key={guest.participantId}
                  guest={guest}
                  roundId={context.roundId}
                  canManage={context.canManage}
                  onDone={router.refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="group-empty" role="status">
          You have not added a guest to this round.
        </p>
      )}

      {context.canManage ? (
        <>
          <div className="group-profile-fields">
            <label className="field-group">
              <span>Guest first name</span>
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className="field-group">
              <span>Guest last name</span>
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className="field-group">
              <span>Quota{quotaRequired ? " (required)" : ""}</span>
              <input
                inputMode="decimal"
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className="field-group">
              <span>Handicap</span>
              <input
                inputMode="decimal"
                value={handicap}
                onChange={(event) => setHandicap(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className="field-group">
              <span>Tee</span>
              <select
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
            </label>
          </div>
          <p className="field-help">
            {quotaRequired
              ? "You enter a quota before you add a guest to this net round."
              : "You can leave quota blank for this gross round."}
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
        </>
      ) : (
        <p className="member-read-note">
          You cannot add or change guests after scoring opens or when your group
          keeps guest additions with coordinators.
        </p>
      )}
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
    </section>
  );
}

function GuestRow({
  canManage,
  guest,
  onDone,
  roundId,
}: Readonly<{
  canManage: boolean;
  guest: MemberRoundGuest;
  onDone: () => void;
  roundId: string;
}>) {
  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState(guest.firstName);
  const [lastName, setLastName] = useState(guest.lastName);
  const [quota, setQuota] = useState(guest.quotaSnapshot ?? "");
  const [handicap, setHandicap] = useState(guest.handicapSnapshot ?? "");
  const [tee, setTee] = useState(guest.teeSnapshot ?? "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  function updateGuest() {
    startTransition(async () => {
      const result = await updateMemberRoundGuestAction({
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
      const result = await withdrawMemberRoundGuestAction({
        roundId,
        participantId: guest.participantId,
        expectedParticipantVersion: guest.version,
        confirmed: true,
        reason: reason.trim(),
        operationId: crypto.randomUUID(),
      });
      setMessage(result.ok ? "You withdraw this guest." : result.error.message);
      if (result.ok) onDone();
    });
  }

  return (
    <tr>
      <th scope="row">
        {canManage ? (
          <>
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
          </>
        ) : (
          `${guest.firstName} ${guest.lastName}`
        )}
      </th>
      <td>
        {guest.rsvpStatus === "playing" ? "Playing" : "Not playing"}
        <small>{message}</small>
      </td>
      <td>
        {canManage ? (
          <input
            aria-label="Guest quota"
            inputMode="decimal"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
            disabled={pending}
          />
        ) : (
          (guest.quotaSnapshot ?? "Not listed")
        )}
      </td>
      <td>
        {canManage ? (
          <input
            aria-label="Guest handicap"
            inputMode="decimal"
            value={handicap}
            onChange={(event) => setHandicap(event.target.value)}
            disabled={pending}
          />
        ) : (
          (guest.handicapSnapshot ?? "Not listed")
        )}
      </td>
      <td>
        {canManage ? (
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
        ) : (
          (guest.teeSnapshot ?? "Not listed")
        )}
      </td>
      {canManage ? (
        <td>
          <input
            aria-label="Reason for guest change"
            placeholder="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
          />
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
      ) : null}
    </tr>
  );
}
