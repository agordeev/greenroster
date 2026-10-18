"use client";

import { useState, useTransition } from "react";

import { setEmailPreferenceAction } from "@/app/actions/notifications";
import { FormMessage, Kicker } from "@/components/blocks";
import { Checkbox } from "@/components/ui/checkbox";

export type MemberNotificationPreference = Readonly<{
  category: string;
  mandatory: boolean;
  email_enabled: boolean;
  email_allowed: boolean;
  version: number;
}>;

// What each e-mail is, in the words a member uses. Categories not listed
// here fall back to their name.
const categoryCopy: Readonly<Record<string, { name: string; detail: string }>> =
  {
    round_published: {
      name: "New rounds",
      detail:
        "When your group posts a round, so you can say if you’re playing.",
    },
    rsvp_reminder: {
      name: "RSVP reminders",
      detail: "A reminder before the deadline if you haven’t answered yet.",
    },
    round_details_changed: {
      name: "Round changes",
      detail: "When the details of a round you’re in change.",
    },
    results_published: {
      name: "Results",
      detail: "Your result and the standings after each round.",
    },
  };

export function MemberNotificationPreferences({
  preferences,
}: Readonly<{
  preferences: readonly MemberNotificationPreference[] | null;
}>) {
  // Only e-mails a member may switch off. The rest always arrive.
  const optional =
    preferences?.filter(
      (preference) => preference.email_allowed && !preference.mandatory,
    ) ?? [];

  return (
    <section
      className="mt-10 border-t pt-8"
      id="notifications"
      aria-labelledby="member-notifications-title"
    >
      <Kicker>E-mails</Kicker>
      <h2
        id="member-notifications-title"
        className="mx-0 mt-1.5 mb-0 text-[1.5rem] font-semibold"
      >
        E-mails you get
      </h2>
      {preferences === null ? (
        <p
          className="mt-2 mb-0 leading-[1.6] text-muted-foreground"
          role="status"
        >
          We couldn’t load your e-mail choices. Refresh the page to try again.
        </p>
      ) : (
        <>
          <p className="mt-2 mb-0 leading-[1.6] text-muted-foreground">
            Choose which e-mails you get. Changes save as you tap.
          </p>
          <ul className="mx-0 mt-5 mb-0 list-none border-b p-0">
            {optional.map((preference) => (
              <PreferenceRow
                key={preference.category}
                preference={preference}
              />
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 mb-0 text-[0.8125rem] leading-[1.55] text-muted-foreground">
        You always get an e-mail if a round is cancelled or your role in the
        group changes.
      </p>
    </section>
  );
}

function PreferenceRow({
  preference,
}: Readonly<{ preference: MemberNotificationPreference }>) {
  const [enabled, setEnabled] = useState(preference.email_enabled);
  const [version, setVersion] = useState(preference.version);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const copy = categoryCopy[preference.category] ?? {
    name: formatCategory(preference.category),
    detail: "",
  };
  const id = `email-${preference.category}`;

  function change(next: boolean) {
    if (pending) return;
    const previous = enabled;
    setEnabled(next);
    setStatus("");
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setEmailPreferenceAction>>;
      try {
        result = await setEmailPreferenceAction({
          category: preference.category,
          enabled: next,
          expectedVersion: version,
          operationId: crypto.randomUUID(),
        });
      } catch {
        setEnabled(previous);
        setError("We couldn’t save that. Try again.");
        setStatus("error");
        return;
      }
      if (!result.ok) {
        setEnabled(previous);
        setError(result.error.message);
        setStatus("error");
        return;
      }
      setEnabled(result.data.emailEnabled);
      setVersion(result.data.version);
      setStatus("saved");
    });
  }

  return (
    <li className="border-t py-3.5">
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={enabled}
          disabled={pending}
          onCheckedChange={(value) => change(value === true)}
          aria-describedby={copy.detail ? `${id}-detail` : undefined}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <label
              htmlFor={id}
              className="cursor-pointer text-[0.9375rem] font-semibold"
            >
              {copy.name}
            </label>
            <span
              className="font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase"
              role="status"
            >
              {pending ? "Saving…" : status === "saved" ? "Saved" : ""}
            </span>
          </div>
          {copy.detail ? (
            <p
              id={`${id}-detail`}
              className="mt-0.5 mb-0 text-[0.8125rem] leading-[1.5] text-muted-foreground"
            >
              {copy.detail}
            </p>
          ) : null}
        </div>
      </div>
      {status === "error" ? (
        <FormMessage className="mt-3" role="alert">
          {error}
        </FormMessage>
      ) : null}
    </li>
  );
}

function formatCategory(value: string): string {
  const words = value.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
