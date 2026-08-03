"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import {
  previewPublishedRoundEditAction,
  updatePublishedRoundEditAction,
} from "@/app/actions/rounds";
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
}: Readonly<{ roundId: string; detail: RoundCoordinatorDetail }>) {
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
      setMessage(firstError(errors) ?? "Review the highlighted fields.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof previewPublishedRoundEditAction>>;
      try {
        result = await previewPublishedRoundEditAction(parsed.data);
      } catch {
        setMessage("The round service is temporarily unavailable. Try again.");
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
          ? "There are no published round changes to apply."
          : "Review the impact before applying this change.",
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
      setMessage(firstError(errors) ?? "Review the highlighted fields.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updatePublishedRoundEditAction>>;
      try {
        result = await updatePublishedRoundEditAction(parsed.data);
      } catch {
        setMessage("The round service is temporarily unavailable. Try again.");
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
          ? `Published round updated. ${result.data.notificationCount} participant notification${result.data.notificationCount === 1 ? "" : "s"} queued.`
          : "Published round updated. No participant notifications were queued.",
      );
      setMessageTone("success");
      router.refresh();
    });
  }

  return (
    <section
      className="group-roles-panel"
      aria-labelledby="published-round-edit-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Published round edit</p>
          <h2 id="published-round-edit-title">Change round details</h2>
        </div>
        <p>Version {version}</p>
      </div>
      <p>
        Format, roster, guest, and scoring snapshots stay unchanged. Preview the
        server-confirmed impact before applying these detail changes.
      </p>
      <div className="group-profile-form" aria-busy={pending}>
        <div className="group-profile-fields">
          <Field
            id="published-round-edit-description"
            label="Description"
            error={fieldErrors.description}
          >
            <input
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
            <input
              id="published-round-edit-venue"
              value={values.venue}
              onChange={(event) => setValue("venue", event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="group-profile-fields">
          <Field
            id="published-round-edit-scheduled"
            label="Scheduled start"
            error={fieldErrors.scheduledLocal}
          >
            <input
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
            <input
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
          label="Round URL"
          error={fieldErrors.roundUrl}
        >
          <input
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
          <textarea
            id="published-round-edit-notes"
            rows={4}
            maxLength={500}
            value={values.notes}
            onChange={(event) => setValue("notes", event.target.value)}
            disabled={pending}
          />
        </Field>
        <label className="bound-choice">
          <input
            type="checkbox"
            checked={values.notesVisibleToPlayers}
            onChange={(event) =>
              setValue("notesVisibleToPlayers", event.target.checked)
            }
            disabled={pending}
          />
          Notes may be visible to players
        </label>
        {preview ? <ImpactSummary preview={preview} /> : null}
        {preview && preview.changedFields.length > 0 ? (
          <label className="bound-choice">
            <input
              type="checkbox"
              checked={announce}
              onChange={(event) => setAnnounce(event.target.checked)}
              disabled={pending}
            />
            Announce this change to affected participants
          </label>
        ) : null}
        {receipt ? <ReceiptSummary receipt={receipt} /> : null}
        <p
          className={`form-message ${messageTone}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
        <div className="information-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={previewChanges}
            disabled={pending}
          >
            {pending && !preview ? "Previewing…" : "Preview changes"}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={applyChanges}
            disabled={pending || !preview || preview.changedFields.length === 0}
          >
            {pending && preview ? "Applying…" : "Apply published edit"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: Readonly<{
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}>) {
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function ImpactSummary({
  preview,
}: Readonly<{ preview: PublishedRoundEditPreview }>) {
  return (
    <section aria-labelledby="published-round-edit-impact-title">
      <p className="ledger-kicker">Impact preview</p>
      <h3 id="published-round-edit-impact-title">Server-confirmed impact</h3>
      <p>
        {preview.affectedParticipantCount} affected participant
        {preview.affectedParticipantCount === 1 ? "" : "s"}.
      </p>
      <ImpactList label="Changed fields" values={preview.changedFields} />
      <ImpactList
        label="Material categories"
        values={preview.materialCategories}
      />
      <ImpactList
        label="Scoring consequences"
        values={preview.scoringConsequences}
      />
      {preview.affectedParticipants.length > 0 ? (
        <div className="publication-member-list round-detail-table-wrap">
          <table>
            <caption>Affected participants</caption>
            <thead>
              <tr>
                <th scope="col">Participant</th>
                <th scope="col">RSVP</th>
              </tr>
            </thead>
            <tbody>
              {preview.affectedParticipants.map((participant) => (
                <tr key={participant.participantId}>
                  <th scope="row">
                    {[participant.firstName, participant.lastName]
                      .filter(Boolean)
                      .join(" ") || "Unnamed participant"}
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
    <aside className="form-message success" role="status">
      Applied at server version {receipt.currentVersion}. The immutable
      participant snapshots remain unchanged.
    </aside>
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
        <p>None reported.</p>
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
