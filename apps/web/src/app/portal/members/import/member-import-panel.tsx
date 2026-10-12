"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Field } from "@/components/ui";

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
          setStatusMessage("Can't get the latest status. Retrying…");
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
            "Quota settings changed, so every row was checked again. Review the import and confirm again.",
          );
        }
        observedJobState.current = body.job.state;
        setJob(body.job);
        if (["uploaded", "validating", "applying"].includes(body.job.state)) {
          timeout = setTimeout(refresh, 1_500);
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("Can't get the latest status. Retrying…");
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
            "Quota settings changed, so every row is being checked again. Review the import and confirm again.",
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
    <div className="member-import-panel">
      <div className="member-import-actions">
        <Link
          className="secondary-button button-link"
          href="/api/member-imports/template"
          prefetch={false}
        >
          Download CSV template
        </Link>
        <Link className="secondary-link" href="/portal/members">
          Return to members
        </Link>
      </div>

      <form onSubmit={submit} className="member-import-form">
        <Field
          id="member-import-file"
          label="CSV file"
          help="UTF-8, up to 500 rows and 2 MiB. Every row is checked before you confirm. If any row has an error, no members are added."
        >
          <input
            ref={fileInput}
            id="member-import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            disabled={pending}
          />
        </Field>
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload and check"}
        </button>
      </form>

      <div className="member-import-result" aria-live="polite">
        {accessMessage ? (
          <div data-status="error">
            <h2>Import access unavailable</h2>
            <p>{accessMessage}</p>
          </div>
        ) : response?.ok ? (
          <div data-status="success">
            <h2>{job ? formatJobState(job.state) : "Checking your file"}</h2>
            <p>
              Your file has {response.job.totalRows}{" "}
              {response.job.totalRows === 1 ? "row" : "rows"}. Reference{" "}
              <code>{response.job.jobId}</code>
            </p>
            {job ? (
              <JobProgress job={job} />
            ) : (
              <p>Checking every row. This page updates automatically.</p>
            )}
            {statusMessage ? (
              <p className="form-message" data-status="error">
                {statusMessage}
              </p>
            ) : null}
            {job?.state === "ready" ? (
              <form className="member-import-confirm" onSubmit={confirmApply}>
                <Field id="member-import-reason" label="Reason">
                  <input
                    id="member-import-reason"
                    value={applyReason}
                    onChange={(event) => setApplyReason(event.target.value)}
                    maxLength={500}
                    required
                    disabled={applyPending}
                  />
                </Field>
                <label className="confirmation-row">
                  <input
                    type="checkbox"
                    checked={applyConfirmed}
                    onChange={(event) =>
                      setApplyConfirmed(event.target.checked)
                    }
                    disabled={applyPending}
                  />
                  Add every valid member and create their invitations. If
                  anything fails, none are added.
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    applyPending || !applyConfirmed || !applyReason.trim()
                  }
                >
                  {applyPending ? "Confirming…" : "Confirm import"}
                </button>
              </form>
            ) : null}
            {applyMessage && job?.state !== "completed" ? (
              <p className="form-message">{applyMessage}</p>
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
                The import is unavailable right now. Try again. If it keeps
                failing, send this reference to support:{" "}
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
    <div className="member-import-progress">
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
        <p>
          Check the counts, then confirm to add every valid row. Skipped rows
          are left out.
        </p>
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
