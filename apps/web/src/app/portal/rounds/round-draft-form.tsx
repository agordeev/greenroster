"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import {
  createRoundDraftAction,
  updateRoundDraftAction,
} from "@/app/actions/rounds";
import {
  ActionRow,
  Field,
  FormMessage,
  SectionHeading,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  onDirtyChange,
}: Readonly<{
  identityKey: string;
  initialValue?: RoundDraftFormValue;
  onDirtyChange?: (dirty: boolean) => void;
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
      setMessage("Nothing has changed yet.");
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
          "Check the highlighted fields.",
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
        setMessage("We couldn't save your round. Try again.");
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
      setMessage(isEdit ? "Draft saved." : "Draft created.");
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
        router.push(
          `/portal/rounds?round=${encodeURIComponent(result.data.roundId)}`,
        );
        return;
      }
      router.refresh();
    });
  }

  function cancel() {
    if (isEdit && dirty && !window.confirm("Discard your unsaved changes?")) {
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
      className="mt-5 gap-5 grid [:where(&)>*]:my-0"
      data-slot="form-stack"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <SectionHeading
        kicker={isEdit ? "Edit draft" : "New draft"}
        title={isEdit ? "Round details" : "New round"}
        meta={isEdit ? "Draft" : "Not published yet"}
      />
      <div className="grid grid-cols-2 gap-y-5 gap-x-4 max-[720px]:grid-cols-[1fr]">
        <Field
          id={`${prefix}-description`}
          label="Description"
          error={fieldErrors.description}
        >
          <Input
            id={`${prefix}-description`}
            ref={descriptionRef}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field id={`${prefix}-venue`} label="Venue" error={fieldErrors.venue}>
          <Input
            id={`${prefix}-venue`}
            ref={venueRef}
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-y-5 gap-x-4 max-[720px]:grid-cols-[1fr]">
        <Field
          id={`${prefix}-scheduled`}
          label="Start time"
          error={fieldErrors.scheduledLocal}
        >
          <Input
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
          <Input
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
        label="Round link"
        error={fieldErrors.roundUrl}
      >
        <Input
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
        <NativeSelect
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
        </NativeSelect>
      </Field>
      <Field id={`${prefix}-notes`} label="Notes" error={fieldErrors.notes}>
        <Textarea
          id={`${prefix}-notes`}
          ref={notesRef}
          rows={4}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <label
        className="gap-[0.4rem] flex items-center text-[0.8125rem]"
        data-slot="bound-choice"
        htmlFor={`${prefix}-notes-visible`}
      >
        <Checkbox
          id={`${prefix}-notes-visible`}
          checked={notesVisibleToPlayers}
          onCheckedChange={(checked) =>
            setNotesVisibleToPlayers(checked === true)
          }
          disabled={disabled}
        />
        Show notes to players after you publish
      </label>
      <FormMessage
        tone={messageTone === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={messageTone || undefined}
      >
        {message}
      </FormMessage>
      <ActionRow>
        <Button type="submit" disabled={disabled}>
          {pending ? "Saving…" : isEdit ? "Save draft" : "Create draft"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={cancel}
          disabled={disabled || !dirty}
        >
          Cancel
        </Button>
      </ActionRow>
    </form>
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
