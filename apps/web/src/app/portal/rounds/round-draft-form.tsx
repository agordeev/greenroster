"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type FormEvent,
} from "react";

import {
  createRoundDraftAction,
  updateRoundDraftAction,
} from "@/app/actions/rounds";
import {
  createRoundDraftInputSchema,
  formatRoundFormat,
  roundDraftFormValue,
  roundFormats,
  updateRoundDraftInputSchema,
  type RoundDraftFormValue,
  type RoundFormat,
} from "@/domain/round-drafts";

type FormField =
  | "description"
  | "scheduledLocal"
  | "venue"
  | "roundUrl"
  | "notes"
  | "rsvpDeadlineLocal"
  | "format"
  | "expectedRoundVersion";
type FormErrors = Partial<Record<FormField, string>>;
type StoredOperation = Readonly<{ operationId: string; payload: string }>;

const blankForm: RoundDraftFormValue = {
  groupTimeZone: "",
  description: "",
  scheduledLocal: "",
  venue: "",
  roundUrl: "",
  notes: "",
  notesVisibleToPlayers: true,
  rsvpDeadlineLocal: "",
  format: "individual_net",
  state: "draft",
  version: 0,
};

export function RoundDraftForm({
  identityKey,
  initialValue,
}: Readonly<{
  identityKey: string;
  initialValue?: RoundDraftFormValue;
}>) {
  const router = useRouter();
  const isEdit = Boolean(initialValue?.roundId);
  const value = initialValue ?? blankForm;
  const storageKey = `greenroster:round-draft:${identityKey}`;
  const operationId = useRef<string | null>(null);
  const operationPayload = useRef<string | null>(null);
  const [description, setDescription] = useState(value.description);
  const [scheduledLocal, setScheduledLocal] = useState(value.scheduledLocal);
  const [venue, setVenue] = useState(value.venue);
  const [roundUrl, setRoundUrl] = useState(value.roundUrl);
  const [notes, setNotes] = useState(value.notes);
  const [notesVisibleToPlayers, setNotesVisibleToPlayers] = useState(
    value.notesVisibleToPlayers,
  );
  const [rsvpDeadlineLocal, setRsvpDeadlineLocal] = useState(
    value.rsvpDeadlineLocal,
  );
  const [format, setFormat] = useState<RoundFormat>(value.format);
  const [version, setVersion] = useState(value.version);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [pending, startTransition] = useTransition();
  const [focusToken, setFocusToken] = useState(0);
  const focusField = useRef<FormField | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const scheduledLocalRef = useRef<HTMLInputElement>(null);
  const venueRef = useRef<HTMLInputElement>(null);
  const roundUrlRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const rsvpDeadlineLocalRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const expectedRoundVersionRef = useRef<HTMLInputElement>(null);

  const dirty = isEdit
    ? description.trim() !== value.description ||
      scheduledLocal.trim() !== value.scheduledLocal ||
      venue.trim() !== value.venue ||
      roundUrl.trim() !== value.roundUrl ||
      notes.trim() !== value.notes ||
      notesVisibleToPlayers !== value.notesVisibleToPlayers ||
      rsvpDeadlineLocal.trim() !== value.rsvpDeadlineLocal ||
      format !== value.format
    : description.trim() !== "" ||
      scheduledLocal.trim() !== "" ||
      venue.trim() !== "" ||
      roundUrl.trim() !== "" ||
      notes.trim() !== "" ||
      !notesVisibleToPlayers ||
      rsvpDeadlineLocal.trim() !== "" ||
      format !== "individual_net";

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const field = focusField.current;
    if (pending || !field) return;
    const focusTarget = {
      description: descriptionRef,
      scheduledLocal: scheduledLocalRef,
      venue: venueRef,
      roundUrl: roundUrlRef,
      notes: notesRef,
      rsvpDeadlineLocal: rsvpDeadlineLocalRef,
      format: formatRef,
      expectedRoundVersion: expectedRoundVersionRef,
    }[field];
    focusTarget?.current?.focus();
    focusField.current = null;
  }, [focusToken, pending]);

  function requestFocus(field: FormField) {
    focusField.current = field;
    setFocusToken((token) => token + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setMessageTone("");
    setFieldErrors({});

    if (isEdit && !dirty) {
      setMessage("There are no round changes to save.");
      setMessageTone("error");
      return;
    }

    const basePayload = {
      description: description.trim(),
      scheduledLocal: scheduledLocal.trim(),
      venue: venue.trim(),
      roundUrl: roundUrl.trim(),
      notes: notes.trim(),
      notesVisibleToPlayers,
      rsvpDeadlineLocal: rsvpDeadlineLocal.trim(),
      format,
    };
    const schema = isEdit
      ? updateRoundDraftInputSchema
      : createRoundDraftInputSchema;
    const candidate = {
      ...basePayload,
      operationId: "00000000-0000-4000-8000-000000000000",
      ...(isEdit
        ? { roundId: value.roundId, expectedRoundVersion: version }
        : {}),
    };
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      const nextErrors = fieldErrorsFromIssues(parsed.error.issues);
      setFieldErrors(nextErrors);
      const firstField = firstFieldWithError(nextErrors);
      if (firstField) requestFocus(firstField);
      setMessage(
        nextErrors[firstField ?? "description"] ??
          "Review the highlighted fields.",
      );
      setMessageTone("error");
      return;
    }

    const payload = isEdit
      ? {
          ...basePayload,
          roundId: value.roundId,
          expectedRoundVersion: version,
        }
      : basePayload;
    const serializedPayload = JSON.stringify(payload);
    if (operationPayload.current !== serializedPayload) {
      const stored = readStoredOperation(storageKey);
      operationId.current =
        stored?.payload === serializedPayload && isUuid(stored.operationId)
          ? stored.operationId
          : crypto.randomUUID();
      operationPayload.current = serializedPayload;
      writeStoredOperation(storageKey, {
        operationId: operationId.current,
        payload: serializedPayload,
      });
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createRoundDraftAction>>;
      try {
        result = isEdit
          ? await updateRoundDraftAction({
              ...payload,
              operationId: operationId.current,
            })
          : await createRoundDraftAction({
              ...payload,
              operationId: operationId.current,
            });
      } catch {
        setMessage("The round service is temporarily unavailable. Try again.");
        setMessageTone("error");
        return;
      }

      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        const nextErrors = fieldErrorsFromResult(result.error.fieldErrors);
        setFieldErrors(nextErrors);
        const firstField = firstFieldWithError(nextErrors);
        if (firstField) requestFocus(firstField);
        if (result.error.code === "stale_version") {
          operationId.current = null;
          operationPayload.current = null;
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      operationPayload.current = null;
      removeStoredOperation(storageKey);
      setFieldErrors({});
      setMessage(isEdit ? "Round draft saved." : "Round draft created.");
      setMessageTone("success");
      if (isEdit) {
        const next = roundDraftFormValue(result.data);
        setDescription(next.description);
        setScheduledLocal(next.scheduledLocal);
        setVenue(next.venue);
        setRoundUrl(next.roundUrl);
        setNotes(next.notes);
        setNotesVisibleToPlayers(next.notesVisibleToPlayers);
        setRsvpDeadlineLocal(next.rsvpDeadlineLocal);
        setFormat(next.format);
        setVersion(next.version);
      } else {
        setDescription("");
        setScheduledLocal("");
        setVenue("");
        setRoundUrl("");
        setNotes("");
        setNotesVisibleToPlayers(true);
        setRsvpDeadlineLocal("");
        setFormat("individual_net");
      }
      router.refresh();
    });
  }

  function cancel() {
    if (isEdit && dirty && !window.confirm("Discard unsaved round changes?")) {
      return;
    }
    setDescription(value.description);
    setScheduledLocal(value.scheduledLocal);
    setVenue(value.venue);
    setRoundUrl(value.roundUrl);
    setNotes(value.notes);
    setNotesVisibleToPlayers(value.notesVisibleToPlayers);
    setRsvpDeadlineLocal(value.rsvpDeadlineLocal);
    setFormat(value.format);
    setVersion(value.version);
    setMessage("");
    setMessageTone("");
    setFieldErrors({});
    operationId.current = null;
    operationPayload.current = null;
    removeStoredOperation(storageKey);
  }

  const disabled = pending || (isEdit && value.state !== "draft");
  const prefix = `round-draft-${identityKey}`;

  return (
    <form
      className="group-profile-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">{isEdit ? "Edit draft" : "New draft"}</p>
          <h2>{isEdit ? "Round details" : "Create a private round"}</h2>
        </div>
        <p>
          {isEdit ? `Version ${version} · ${value.state}` : "Draft · Version 1"}
        </p>
      </div>
      <p className="field-help">
        Local date and time use the group time zone:{" "}
        {value.groupTimeZone || "not resolved"}.
      </p>
      <div className="group-profile-fields">
        <Field
          id={`${prefix}-description`}
          label="Description"
          error={fieldErrors.description}
        >
          <input
            id={`${prefix}-description`}
            ref={descriptionRef}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field id={`${prefix}-venue`} label="Venue" error={fieldErrors.venue}>
          <input
            id={`${prefix}-venue`}
            ref={venueRef}
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="group-profile-fields">
        <Field
          id={`${prefix}-scheduled`}
          label="Scheduled start"
          error={fieldErrors.scheduledLocal}
        >
          <input
            id={`${prefix}-scheduled`}
            ref={scheduledLocalRef}
            type="datetime-local"
            value={scheduledLocal}
            onChange={(event) => setScheduledLocal(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field
          id={`${prefix}-deadline`}
          label="RSVP deadline"
          error={fieldErrors.rsvpDeadlineLocal}
        >
          <input
            id={`${prefix}-deadline`}
            ref={rsvpDeadlineLocalRef}
            type="datetime-local"
            value={rsvpDeadlineLocal}
            onChange={(event) => setRsvpDeadlineLocal(event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field
        id={`${prefix}-url`}
        label="Round URL"
        error={fieldErrors.roundUrl}
      >
        <input
          id={`${prefix}-url`}
          ref={roundUrlRef}
          type="url"
          placeholder="https://..."
          value={roundUrl}
          onChange={(event) => setRoundUrl(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field id={`${prefix}-format`} label="Format" error={fieldErrors.format}>
        <select
          id={`${prefix}-format`}
          ref={formatRef}
          value={format}
          onChange={(event) => setFormat(event.target.value as RoundFormat)}
          disabled={disabled}
        >
          {roundFormats.map((option) => (
            <option key={option} value={option}>
              {formatRoundFormat(option)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${prefix}-notes`} label="Notes" error={fieldErrors.notes}>
        <textarea
          id={`${prefix}-notes`}
          ref={notesRef}
          rows={4}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <label className="bound-choice" htmlFor={`${prefix}-notes-visible`}>
        <input
          id={`${prefix}-notes-visible`}
          type="checkbox"
          checked={notesVisibleToPlayers}
          onChange={(event) => setNotesVisibleToPlayers(event.target.checked)}
          disabled={disabled}
        />
        Notes may be visible to players after publication
      </label>
      <p
        className="form-message"
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </p>
      <div className="information-actions">
        <button className="primary-button" type="submit" disabled={disabled}>
          {pending ? "Saving…" : isEdit ? "Save draft" : "Create draft"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={cancel}
          disabled={disabled || !dirty}
        >
          Cancel
        </button>
      </div>
    </form>
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

function fieldErrorsFromIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FormErrors {
  const errors: FormErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      field in blankForm &&
      !errors[field as FormField]
    ) {
      errors[field as FormField] = issue.message;
    }
  }
  return errors;
}

function fieldErrorsFromResult(
  errors: Readonly<Record<string, readonly string[]>> | undefined,
): FormErrors {
  if (!errors) return {};
  const next: FormErrors = {};
  for (const field of Object.keys(blankForm) as FormField[]) {
    const message = errors[field]?.[0];
    if (message) next[field] = message;
  }
  return next;
}

function firstFieldWithError(errors: FormErrors): FormField | null {
  for (const field of [
    "description",
    "scheduledLocal",
    "venue",
    "roundUrl",
    "notes",
    "rsvpDeadlineLocal",
    "format",
    "expectedRoundVersion",
  ] as const) {
    if (errors[field]) return field;
  }
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function readStoredOperation(key: string): StoredOperation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "operationId" in value &&
      "payload" in value &&
      typeof value.operationId === "string" &&
      typeof value.payload === "string"
    ) {
      return value as StoredOperation;
    }
  } catch {
    // Browser storage is best effort; the mounted form keeps its operation id.
  }
  return null;
}

function writeStoredOperation(key: string, value: StoredOperation) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Continue with the in-memory operation id.
  }
}

function removeStoredOperation(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Cleanup is best effort after a committed mutation.
  }
}
