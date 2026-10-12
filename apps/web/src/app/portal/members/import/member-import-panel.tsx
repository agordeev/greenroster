"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Field, FormMessage, TextLink } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

import { requestMemberImportApplyAction } from "../../../actions/member-imports";
import {
  memberImportAccessFailure,
  memberImportApplyFailure,
  memberImportApplyTransportFailure,
  memberImportWasRequeuedAfterApply,
  type MemberImportFailurePlan,
} from "../../../../lib/member-imports/member-import-panel-state";

type UploadError = Readonly<{
  code: string;
  column?: string;
  message: string;
  rowNumber?: number;
}>;

type UploadResponse =
  | Readonly<{
      ok: true;
      correlationId: string;
      job: Readonly<{
        jobId: string;
        state: string;
        totalRows: number;
      }>;
    }>
  | Readonly<{
      ok: false;
      correlationId: string;
      code: string;
      errors?: readonly UploadError[];
    }>;

type JobProjection = Readonly<{
  jobId: string;
  state:
    "uploaded" | "validating" | "ready" | "rejected" | "applying" | "completed";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  skippedRows: number;
  appliedRows: number;
  revision: number;
  rows: readonly Readonly<{
    rowNumber: number;
    state: string;
    errors: readonly Readonly<{ code: string; column?: string }>[];
  }>[];
}>;

export function MemberImportPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<UploadResponse | null>(null);
  const [job, setJob] = useState<JobProjection | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [applyReason, setApplyReason] = useState("");
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [accessMessage, setAccessMessage] = useState("");
  const applyOperationId = useRef(crypto.randomUUID());
  const observedJobState = useRef<JobProjection["state"] | null>(null);

  const applyFailurePlan = useCallback((plan: MemberImportFailurePlan) => {
    if (plan.clearJob) {
      observedJobState.current = null;
      setJob(null);
    }
    if (plan.clearConfirmation) setApplyConfirmed(false);
    if (plan.rotateOperationId) applyOperationId.current = crypto.randomUUID();
    if (plan.accessMessage) setAccessMessage(plan.accessMessage);
    setApplyMessage(plan.applyMessage);
    if (plan.refreshStatus) {
      setResponse((current) => (current?.ok ? { ...current } : current));
    }
  }, []);

  useEffect(() => {
    const jobId = response?.ok ? response.job.jobId : null;
    if (!jobId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;

    function retry() {
      consecutiveFailures += 1;
      const delay = Math.min(1_500 * 2 ** (consecutiveFailures - 1), 12_000);
      timeout = setTimeout(refresh, delay);
    }

    async function refresh() {
      try {
        const result = await fetch(`/api/member-imports/${jobId}`, {
          cache: "no-store",
        });
        const body = (await result.json()) as
          | { ok: true; job: JobProjection }
          | {
              ok: false;
              status: "authentication_required" | "forbidden" | "unavailable";
            };
        if (cancelled) return;
        if (!body.ok) {
          if (body.status === "authentication_required") {
            applyFailurePlan(memberImportAccessFailure(body.status));
            return;
          }
          if (body.status === "forbidden") {
            applyFailurePlan(memberImportAccessFailure(body.status));
            return;
          }
          setStatusMessage("We can't get the latest status. Trying again…");
          retry();
          return;
        }
        consecutiveFailures = 0;
        setAccessMessage("");
        setStatusMessage("");
        if (
          memberImportWasRequeuedAfterApply(
            observedJobState.current,
            body.job.state,
          )
        ) {
          setApplyConfirmed(false);
          applyOperationId.current = crypto.randomUUID();
          setApplyMessage(
            "Your quota rules changed, so we checked every row again. Look over the import and confirm again.",
          );
        }
        observedJobState.current = body.job.state;
        setJob(body.job);
        if (["uploaded", "validating", "applying"].includes(body.job.state)) {
          timeout = setTimeout(refresh, 1_500);
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("We can't get the latest status. Trying again…");
          retry();
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [applyFailurePlan, response]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setResponse({
        ok: false,
        code: "validation",
        correlationId: crypto.randomUUID(),
        errors: [{ code: "file_required", message: "Choose a CSV file." }],
      });
      return;
    }

    setPending(true);
    setResponse(null);
    setJob(null);
    observedJobState.current = null;
    setApplyMessage("");
    setStatusMessage("");
    setAccessMessage("");
    setApplyReason("");
    setApplyConfirmed(false);
    applyOperationId.current = crypto.randomUUID();
    const form = new FormData();
    form.set("file", file);
    try {
      const result = await fetch("/api/member-imports", {
        body: form,
        method: "POST",
      });
      const body = (await result.json()) as UploadResponse;
      setResponse(body);
    } catch {
      setResponse({
        ok: false,
        code: "unavailable",
        correlationId: crypto.randomUUID(),
      });
    } finally {
      setPending(false);
    }
  }

  async function confirmApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !job ||
      job.state !== "ready" ||
      !applyConfirmed ||
      !applyReason.trim()
    ) {
      return;
    }
    setApplyPending(true);
    setApplyMessage("");
    try {
      const result = await requestMemberImportApplyAction({
        jobId: job.jobId,
        expectedRevision: job.revision,
        confirmed: true,
        reason: applyReason,
        operationId: applyOperationId.current,
      });
      if (result.ok) {
        observedJobState.current = result.data.state;
        setJob({
          ...job,
          state: result.data.state,
          revision: result.data.revision,
        });
        if (result.data.state === "uploaded") {
          setApplyConfirmed(false);
          applyOperationId.current = crypto.randomUUID();
          setApplyMessage(
            "Your quota rules changed, so we're checking every row again. Look over the import and confirm again.",
          );
        } else {
          setApplyMessage(
            "Adding members now. This page updates when the import finishes.",
          );
        }
        setResponse((current) => (current?.ok ? { ...current } : current));
      } else {
        applyFailurePlan(
          memberImportApplyFailure(
            result.error.code,
            result.error.correlationId,
          ),
        );
      }
    } catch {
      // The request may have reached the server even when its response was
      // lost. Treat reconciliation as an observed Applying state so a fast
      // settings-drift requeue still forces a fresh confirmation/idempotency
      // key when the first poll has already returned to Ready.
      observedJobState.current = "applying";
      applyFailurePlan(memberImportApplyTransportFailure());
    } finally {
      setApplyPending(false);
    }
  }

  return (
    <div className="mt-10 pt-8 gap-8 border-t grid">
      <div className="gap-4 flex flex-wrap items-center">
        <Button asChild variant="outline">
          <Link href="/api/member-imports/template" prefetch={false}>
            Download CSV template
          </Link>
        </Button>
        <TextLink href="/portal/members">Return to members</TextLink>
      </div>

      <form
        onSubmit={submit}
        className="gap-5 grid max-w-152 [&_:is([data-slot=field],[data-slot='field'])]:gap-2 [&_:is([data-slot=field],[data-slot='field'])]:grid"
      >
        <Field id="member-import-file" label="CSV file" help="Up to 500 rows.">
          <Input
            ref={fileInput}
            id="member-import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            disabled={pending}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload and check"}
        </Button>
      </form>

      <div
        className="[&>div]:p-5 [&>div]:border [&_[data-status='error']]:border-destructive! [&_[data-status='success']]:border-primary [&_code]:wrap-anywhere [&_h2]:mx-0 [&_h2]:mt-0 [&_h2]:mb-3 [&_h2]:font-semibold"
        aria-live="polite"
      >
        {accessMessage ? (
          <div data-status="error">
            <h2>You can&apos;t import members</h2>
            <p>{accessMessage}</p>
          </div>
        ) : response?.ok ? (
          <div data-status="success">
            <h2>{job ? formatJobState(job.state) : "Checking your file"}</h2>
            <p>
              Your file has {response.job.totalRows}{" "}
              {response.job.totalRows === 1 ? "row" : "rows"}.
            </p>
            {job ? <JobProgress job={job} /> : <p>Checking every row.</p>}
            {statusMessage ? (
              <FormMessage data-status="error">{statusMessage}</FormMessage>
            ) : null}
            {job?.state === "ready" ? (
              <form
                className="mt-6 pt-6 gap-4 border-t grid [&_:is([data-slot=field],[data-slot='field'])]:gap-2 [&_:is([data-slot=field],[data-slot='field'])]:grid"
                onSubmit={confirmApply}
              >
                <Field id="member-import-reason" label="Reason">
                  <Input
                    id="member-import-reason"
                    value={applyReason}
                    onChange={(event) => setApplyReason(event.target.value)}
                    maxLength={500}
                    required
                    disabled={applyPending}
                  />
                </Field>
                <label className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] font-normal leading-[1.45] [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]">
                  <Checkbox
                    checked={applyConfirmed}
                    onCheckedChange={(checked) =>
                      setApplyConfirmed(checked === true)
                    }
                    disabled={applyPending}
                  />
                  Add these members and create their invitations.
                </label>
                <Button
                  type="submit"
                  disabled={
                    applyPending || !applyConfirmed || !applyReason.trim()
                  }
                >
                  {applyPending ? "Confirming…" : "Confirm import"}
                </Button>
              </form>
            ) : null}
            {applyMessage && job?.state !== "completed" ? (
              <FormMessage>{applyMessage}</FormMessage>
            ) : null}
          </div>
        ) : response ? (
          <div data-status="error">
            <h2>This file can&apos;t be imported</h2>
            {response.code === "forbidden" ? (
              <p>Only coordinators and administrators can import members.</p>
            ) : response.code === "authentication_required" ? (
              <p>You&apos;ve been signed out. Sign in again to continue.</p>
            ) : response.errors?.length ? (
              <ul>
                {response.errors.map((error, index) => (
                  <li
                    key={`${error.rowNumber ?? 0}:${error.column ?? "file"}:${error.code}:${index}`}
                  >
                    {error.rowNumber ? `Row ${error.rowNumber}: ` : ""}
                    {error.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                We couldn&apos;t run the import. Try again. If it keeps failing,
                send this reference to support:{" "}
                <code>{response.correlationId}</code>
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatJobState(state: JobProjection["state"]): string {
  return {
    uploaded: "Uploaded",
    validating: "Checking every row",
    ready: "Ready to confirm",
    rejected: "This file has errors",
    applying: "Adding members",
    completed: "Import completed",
  }[state];
}

function JobProgress({ job }: Readonly<{ job: JobProjection }>) {
  return (
    <div className="[&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-[1.5rem] [&_dl>div]:p-3 [&_dl>div]:border-t [&_dl]:my-4 [&_dl]:mx-0 [&_dl]:gap-3 [&_dl]:grid [&_dl]:grid-cols-4 [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.06em] [&_dt]:uppercase">
      <dl>
        <div>
          <dt>Valid</dt>
          <dd>{job.validRows}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{job.skippedRows}</dd>
        </div>
        <div>
          <dt>With errors</dt>
          <dd>{job.invalidRows}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{job.appliedRows}</dd>
        </div>
      </dl>
      {job.state === "ready" ? (
        <p>Check the counts, then confirm to add every valid row.</p>
      ) : null}
      {job.rows.some((row) => row.errors.length > 0) ? (
        <ul>
          {job.rows.flatMap((row) =>
            row.errors.map((error, index) => (
              <li key={`${row.rowNumber}:${error.code}:${index}`}>
                Row {row.rowNumber}: {error.column ? `${error.column} — ` : ""}
                {error.code.replaceAll("_", " ")}
              </li>
            )),
          )}
        </ul>
      ) : null}
    </div>
  );
}
