"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  previewPublishedRoundEditAction,
  updatePublishedRoundEditAction,
} from "@/app/actions/rounds";
import {
  ActionRow,
  Field,
  FormMessage,
  Kicker,
  SectionHeading,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  previewPublishedRoundEditInputSchema,
  updatePublishedRoundEditInputSchema,
  type PublishedRoundEditPreview,
  type PublishedRoundEditReceipt,
} from "@/domain/published-round-edit";
import type { RoundCoordinatorDetail } from "@/domain/round-detail";
import { toLocalDateTimeInput } from "@/domain/round-drafts";

type EditField =
  | "description"
  | "scheduledLocal"
  | "venue"
  | "roundUrl"
  | "notes"
  | "rsvpDeadlineLocal";
type EditValues = Readonly<{
  description: string;
  scheduledLocal: string;
  venue: string;
  roundUrl: string;
  notes: string;
  notesVisibleToPlayers: boolean;
  rsvpDeadlineLocal: string;
}>;
type EditErrors = Partial<Record<EditField, string>>;

export function PublishedRoundEditPanel({
  roundId,
  detail,
  onDirtyChange,
}: Readonly<{
  roundId: string;
  detail: RoundCoordinatorDetail;
  onDirtyChange?: (dirty: boolean) => void;
}>) {
  const router = useRouter();
  const [values, setValues] = useState<EditValues>(() =>
    valuesFromDetail(detail),
  );
  const [version, setVersion] = useState(detail.version);
  const [preview, setPreview] = useState<PublishedRoundEditPreview | null>(
    null,
  );
  const [receipt, setReceipt] = useState<PublishedRoundEditReceipt | null>(
    null,
  );
  const [announce, setAnnounce] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [fieldErrors, setFieldErrors] = useState<EditErrors>({});
  const [pending, startTransition] = useTransition();
  const operationId = useRef<string | null>(null);
  const initialValues = valuesFromDetail(detail);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  function setValue<K extends keyof EditValues>(
    field: K,
    value: EditValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setReceipt(null);
    setMessage("");
    setMessageTone("");
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function previewChanges() {
    setMessage("");
    setMessageTone("");
    setFieldErrors({});
    setReceipt(null);
    setPreview(null);
    const parsed = previewPublishedRoundEditInputSchema.safeParse({
      roundId,
      ...values,
      expectedRoundVersion: version,
    });
    if (!parsed.success) {
      const errors = errorsFromIssues(parsed.error.issues);
      setFieldErrors(errors);
      setMessage(firstError(errors) ?? "Check the highlighted fields.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof previewPublishedRoundEditAction>>;
      try {
        result = await previewPublishedRoundEditAction(parsed.data);
      } catch {
        setMessage("We couldn't preview your changes. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        const errors = errorsFromResult(result.error.fieldErrors);
        setFieldErrors(errors);
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "stale_version") {
          router.refresh();
        }
        return;
      }
      setPreview(result.data);
      setAnnounce(false);
      setMessage(
        result.data.changedFields.length === 0
          ? "Nothing has changed. Edit something, then preview again."
          : "Check what changes below before you apply.",
      );
      setMessageTone(
        result.data.changedFields.length === 0 ? "error" : "success",
      );
    });
  }

  function applyChanges() {
    if (!preview || preview.changedFields.length === 0) return;
    setMessage("");
    setMessageTone("");
    setFieldErrors({});
    operationId.current ??= crypto.randomUUID();
    const parsed = updatePublishedRoundEditInputSchema.safeParse({
      roundId,
      ...values,
      expectedRoundVersion: version,
      impactFingerprint: preview.impactFingerprint,
      announce,
      operationId: operationId.current,
    });
    if (!parsed.success) {
      const errors = errorsFromIssues(parsed.error.issues);
      setFieldErrors(errors);
      setMessage(firstError(errors) ?? "Check the highlighted fields.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updatePublishedRoundEditAction>>;
      try {
        result = await updatePublishedRoundEditAction(parsed.data);
      } catch {
        setMessage("We couldn't apply your changes. Try again.");
        setMessageTone("error");
        return;
      }
      if (!result.ok) {
        const errors = errorsFromResult(result.error.fieldErrors);
        setFieldErrors(errors);
        setMessage(result.error.message);
        setMessageTone("error");
        if (
          result.error.code === "stale_version" ||
          result.error.code === "locked" ||
          result.error.code === "operation_reused"
        ) {
          operationId.current = null;
          setPreview(null);
          router.refresh();
        }
        return;
      }
      operationId.current = null;
      setReceipt(result.data);
      setPreview(null);
      setVersion(result.data.currentVersion);
      setMessage(
        result.data.announce
          ? `Changes applied. ${result.data.notificationCount} e-mail${result.data.notificationCount === 1 ? "" : "s"} will be sent to players.`
          : "Changes applied. No e-mails will be sent.",
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="published-round-edit-title"
    >
      <SectionHeading
        kicker="Published round"
        title="Change round details"
        titleId="published-round-edit-title"
        meta="Preview before you apply"
      />
      <p>Preview your changes before you apply them.</p>
      <div
        className="mt-5 gap-5 grid [:where(&)>*]:my-0"
        data-slot="form-stack"
        aria-busy={pending}
      >
        <div className="grid grid-cols-2 gap-y-5 gap-x-4 max-[720px]:grid-cols-[1fr]">
          <Field
            id="published-round-edit-description"
            label="Description"
            error={fieldErrors.description}
          >
            <Input
              id="published-round-edit-description"
              value={values.description}
              onChange={(event) => setValue("description", event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field
            id="published-round-edit-venue"
            label="Venue"
            error={fieldErrors.venue}
          >
            <Input
              id="published-round-edit-venue"
              value={values.venue}
              onChange={(event) => setValue("venue", event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-y-5 gap-x-4 max-[720px]:grid-cols-[1fr]">
          <Field
            id="published-round-edit-scheduled"
            label="Start time"
            error={fieldErrors.scheduledLocal}
          >
            <Input
              id="published-round-edit-scheduled"
              type="datetime-local"
              value={values.scheduledLocal}
              onChange={(event) =>
                setValue("scheduledLocal", event.target.value)
              }
              disabled={pending}
            />
          </Field>
          <Field
            id="published-round-edit-deadline"
            label="RSVP deadline"
            error={fieldErrors.rsvpDeadlineLocal}
          >
            <Input
              id="published-round-edit-deadline"
              type="datetime-local"
              value={values.rsvpDeadlineLocal}
              onChange={(event) =>
                setValue("rsvpDeadlineLocal", event.target.value)
              }
              disabled={pending}
            />
          </Field>
        </div>
        <Field
          id="published-round-edit-url"
          label="Round link"
          error={fieldErrors.roundUrl}
        >
          <Input
            id="published-round-edit-url"
            type="url"
            placeholder="https://..."
            value={values.roundUrl}
            onChange={(event) => setValue("roundUrl", event.target.value)}
            disabled={pending}
          />
        </Field>
        <Field
          id="published-round-edit-notes"
          label="Notes"
          error={fieldErrors.notes}
        >
          <Textarea
            id="published-round-edit-notes"
            rows={4}
            maxLength={500}
            value={values.notes}
            onChange={(event) => setValue("notes", event.target.value)}
            disabled={pending}
          />
        </Field>
        <label
          className="gap-[0.4rem] flex items-center text-[0.8125rem]"
          data-slot="bound-choice"
        >
          <Checkbox
            checked={values.notesVisibleToPlayers}
            onCheckedChange={(checked) =>
              setValue("notesVisibleToPlayers", checked === true)
            }
            disabled={pending}
          />
          Show notes to players
        </label>
        {preview ? <ImpactSummary preview={preview} /> : null}
        {preview && preview.changedFields.length > 0 ? (
          <label
            className="gap-[0.4rem] flex items-center text-[0.8125rem]"
            data-slot="bound-choice"
          >
            <Checkbox
              checked={announce}
              onCheckedChange={(checked) => setAnnounce(checked === true)}
              disabled={pending}
            />
            E-mail affected players about this change
          </label>
        ) : null}
        {receipt ? <ReceiptSummary receipt={receipt} /> : null}
        <FormMessage
          tone={messageTone === "success" ? "success" : "error"}
          role="status"
          aria-live="polite"
        >
          {message}
        </FormMessage>
        <ActionRow>
          <Button
            variant="outline"
            type="button"
            onClick={previewChanges}
            disabled={pending}
          >
            {pending && !preview ? "Previewing…" : "Preview changes"}
          </Button>
          <Button
            type="button"
            onClick={applyChanges}
            disabled={pending || !preview || preview.changedFields.length === 0}
          >
            {pending && preview ? "Applying…" : "Apply changes"}
          </Button>
        </ActionRow>
      </div>
    </section>
  );
}

function ImpactSummary({
  preview,
}: Readonly<{ preview: PublishedRoundEditPreview }>) {
  return (
    <section aria-labelledby="published-round-edit-impact-title">
      <Kicker>Preview</Kicker>
      <h3 id="published-round-edit-impact-title">What this changes</h3>
      <p>
        {preview.affectedParticipantCount} affected player
        {preview.affectedParticipantCount === 1 ? "" : "s"}.
      </p>
      <ImpactList label="Changed details" values={preview.changedFields} />
      <ImpactList
        label="Changes players should know about"
        values={preview.materialCategories}
      />
      <ImpactList
        label="Effect on scores"
        values={preview.scoringConsequences}
      />
      {preview.affectedParticipants.length > 0 ? (
        <div
          className="mt-8 max-w-full overflow-x-auto [overscroll-behavior-inline:contain] [&_h3]:m-0 [&_h3]:text-[1.125rem] [&_h3]:font-semibold [&_table]:min-w-184 [&_table]:border-collapse [&_td]:p-3 [&_td]:border-b [&_td]:border-b-border/50 [&_td]:text-left [&_td]:whitespace-nowrap [&_td]:text-muted-foreground [&_td]:text-[0.8125rem] [&_th]:p-3 [&_th]:border-b [&_th]:border-b-border/50 [&_th]:text-left [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_th]:font-mono [&_th]:text-[0.6875rem] [&_th]:tracking-[0.05em] [&_th]:uppercase"
          data-slot="round-detail-table-wrap"
        >
          <table>
            <caption>Affected players</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">RSVP</th>
              </tr>
            </thead>
            <tbody>
              {preview.affectedParticipants.map((participant) => (
                <tr key={participant.participantId}>
                  <th scope="row">
                    {[participant.firstName, participant.lastName]
                      .filter(Boolean)
                      .join(" ") || "Unnamed player"}
                  </th>
                  <td>{formatRsvp(participant.rsvpStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ReceiptSummary({
  receipt,
}: Readonly<{ receipt: PublishedRoundEditReceipt }>) {
  return (
    <FormMessage tone="success" role="status">
      Changes applied. Player quotas, handicaps, and tees stay as they were.
      {receipt.notificationCount > 0
        ? ` ${receipt.notificationCount} e-mail${receipt.notificationCount === 1 ? "" : "s"} will be sent.`
        : null}
    </FormMessage>
  );
}

function ImpactList({
  label,
  values,
}: Readonly<{ label: string; values: readonly string[] }>) {
  return (
    <div>
      <strong>{label}</strong>
      {values.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function valuesFromDetail(detail: RoundCoordinatorDetail): EditValues {
  return {
    description: detail.description ?? "",
    scheduledLocal: toLocalDateTimeInput(
      detail.scheduledAt,
      detail.groupTimeZone,
    ),
    venue: detail.venue ?? "",
    roundUrl: detail.roundUrl ?? "",
    notes: detail.notes ?? "",
    notesVisibleToPlayers: detail.notesVisibleToPlayers,
    rsvpDeadlineLocal: toLocalDateTimeInput(
      detail.rsvpDeadlineAt,
      detail.groupTimeZone,
    ),
  };
}

function errorsFromIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): EditErrors {
  const errors: EditErrors = {};
  for (const issue of issues) {
    const path = issue.path[0];
    if (
      typeof path === "string" &&
      [
        "description",
        "scheduledLocal",
        "venue",
        "roundUrl",
        "notes",
        "rsvpDeadlineLocal",
      ].includes(path) &&
      !errors[path as EditField]
    ) {
      errors[path as EditField] = issue.message;
    }
  }
  return errors;
}

function firstError(errors: EditErrors): string | undefined {
  return Object.values(errors).find((value): value is string => Boolean(value));
}

function errorsFromResult(
  fieldErrors: Readonly<Record<string, readonly string[]>> | undefined,
): EditErrors {
  if (!fieldErrors) return {};
  const errors: EditErrors = {};
  for (const field of [
    "description",
    "scheduledLocal",
    "venue",
    "roundUrl",
    "notes",
    "rsvpDeadlineLocal",
  ] as const) {
    const message = fieldErrors[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

function formatRsvp(status: "no_response" | "playing" | "not_playing") {
  return status === "no_response"
    ? "No response"
    : status === "not_playing"
      ? "Not playing"
      : "Playing";
}
