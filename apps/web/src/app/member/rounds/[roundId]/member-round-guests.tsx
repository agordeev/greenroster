"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import {
  createMemberRoundGuestAction,
  withdrawMemberRoundGuestAction,
} from "@/app/actions/rounds";
import { Field, FormMessage, Kicker } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberRoundGuest } from "@/domain/member-round-detail";

type Message = Readonly<{ text: string; tone: "error" | "success" }> | null;

// A member's own guests for a published round: add one, or take one off
// again, until the RSVP deadline. Scores for guests are entered once the round
// is live, in the score panel.
export function MemberRoundGuests({
  roundId,
  format,
  canManage,
  guests,
}: Readonly<{
  roundId: string;
  format: "individual_net" | "individual_gross";
  canManage: boolean;
  guests: readonly MemberRoundGuest[];
}>) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [quota, setQuota] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  const quotaRequired = format === "individual_net";
  const playingGuests = guests.filter(
    (guest) => guest.rsvpStatus === "playing",
  );

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    operationId.current = null;
    setMessage(null);
  }

  function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    operationId.current ??= crypto.randomUUID();
    setMessage(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createMemberRoundGuestAction>>;
      try {
        result = await createMemberRoundGuestAction({
          roundId,
          firstName,
          lastName,
          quotaSnapshot: quota.trim() || null,
          handicapSnapshot: null,
          teeSnapshot: null,
          operationId: operationId.current,
        });
      } catch {
        setMessage({
          text: "We couldn't add your guest. Try again.",
          tone: "error",
        });
        return;
      }
      if (!result.ok) {
        setMessage({ text: result.error.message, tone: "error" });
        return;
      }
      operationId.current = null;
      setFirstName("");
      setLastName("");
      setQuota("");
      setMessage({
        text: `${result.data.firstName} ${result.data.lastName} is on the list for this round.`,
        tone: "success",
      });
      router.refresh();
    });
  }

  if (!canManage && playingGuests.length === 0) return null;

  return (
    <section
      className="mt-10 border-t pt-8"
      aria-labelledby="member-guests-title"
    >
      <Kicker>Your guests</Kicker>
      <h2
        id="member-guests-title"
        className="mx-0 mt-1.5 mb-0 text-[1.5rem] font-semibold"
      >
        Bringing a guest?
      </h2>
      <p className="mt-2 mb-0 leading-[1.6] text-muted-foreground">
        {canManage
          ? "Add your guest before the RSVP deadline. You can take them off the list until then."
          : "Ask your coordinator if your guest list needs to change."}
      </p>

      {playingGuests.length > 0 ? (
        <ul className="mx-0 mt-5 mb-0 list-none border-b p-0">
          {playingGuests.map((guest) => (
            <GuestRow
              key={`${guest.participantId}:${guest.version}`}
              roundId={roundId}
              guest={guest}
              canManage={canManage}
            />
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <form className="mt-6 grid gap-4" onSubmit={addGuest} noValidate>
          <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
            <Field id="guest-first-name" label="First name">
              <Input
                id="guest-first-name"
                value={firstName}
                onChange={(event) => edit(setFirstName, event.target.value)}
                autoComplete="off"
                maxLength={100}
                disabled={pending}
              />
            </Field>
            <Field id="guest-last-name" label="Last name">
              <Input
                id="guest-last-name"
                value={lastName}
                onChange={(event) => edit(setLastName, event.target.value)}
                autoComplete="off"
                maxLength={100}
                disabled={pending}
              />
            </Field>
          </div>
          {quotaRequired ? (
            <Field
              id="guest-quota"
              label="Your guest's quota"
              help="The points your guest is expected to score in this round. Ask your coordinator if you're not sure."
            >
              <Input
                id="guest-quota"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={quota}
                onChange={(event) => edit(setQuota, event.target.value)}
                disabled={pending}
                className="max-w-40"
              />
            </Field>
          ) : null}
          {message ? (
            <FormMessage tone={message.tone} role="status">
              {message.text}
            </FormMessage>
          ) : null}
          <Button
            type="submit"
            disabled={
              pending ||
              !firstName.trim() ||
              !lastName.trim() ||
              (quotaRequired && !quota.trim())
            }
          >
            {pending ? "Adding your guest…" : "Add guest"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function GuestRow({
  roundId,
  guest,
  canManage,
}: Readonly<{
  roundId: string;
  guest: MemberRoundGuest;
  canManage: boolean;
}>) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  const name = `${guest.firstName} ${guest.lastName}`;
  const reasonId = `guest-reason-${guest.participantId}`;

  function removeGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!reason.trim()) {
      setMessage({
        text: "Tell your coordinator why your guest isn't coming.",
        tone: "error",
      });
      return;
    }
    operationId.current ??= crypto.randomUUID();
    setMessage(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof withdrawMemberRoundGuestAction>>;
      try {
        result = await withdrawMemberRoundGuestAction({
          roundId,
          participantId: guest.participantId,
          expectedParticipantVersion: guest.version,
          confirmed: true,
          reason: reason.trim(),
          operationId: operationId.current,
        });
      } catch {
        setMessage({
          text: "We couldn't take your guest off. Try again.",
          tone: "error",
        });
        return;
      }
      if (!result.ok) {
        setMessage({ text: result.error.message, tone: "error" });
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="border-t py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <p className="m-0 font-semibold">{name}</p>
          {guest.quotaSnapshot !== null ? (
            <p className="m-0 text-[0.8125rem] text-muted-foreground">
              Quota {guest.quotaSnapshot}
            </p>
          ) : null}
        </div>
        {canManage && !removing ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRemoving(true)}
          >
            Take off the list
          </Button>
        ) : null}
      </div>
      {removing ? (
        <form className="mt-4 grid gap-3" onSubmit={removeGuest} noValidate>
          <Field
            id={reasonId}
            label={`Why isn't ${guest.firstName} coming?`}
            help="Your coordinator sees this."
          >
            <Input
              id={reasonId}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                operationId.current = null;
                setMessage(null);
              }}
              maxLength={500}
              disabled={pending}
            />
          </Field>
          {message ? (
            <FormMessage tone={message.tone} role="status">
              {message.text}
            </FormMessage>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Taking them off…" : `Take ${guest.firstName} off`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setRemoving(false);
                setReason("");
                setMessage(null);
              }}
            >
              Keep {guest.firstName}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
