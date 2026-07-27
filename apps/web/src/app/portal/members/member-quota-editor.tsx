"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { configureMemberQuotaBootstrapAction } from "@/app/actions/memberships";
import { projectMemberQuotaBootstrap } from "@/domain/member-quota-bootstrap";
import { signInPath } from "@/lib/auth/safe-return-path";
import type { MemberQuotaBootstrapContext } from "@/lib/memberships/member-quota-bootstrap";
import { shouldAllowDirtyNavigation } from "@/lib/groups/quota-settings-form-rules";

import {
  MAX_MEMBER_QUOTA_SEEDS,
  memberQuotaEditorDraftFingerprint,
  memberQuotaEditorInput,
  memberQuotaEditorRecoveryStorageKeyForMembership,
  parseMemberQuotaEditorRecovery,
  retainMemberQuotaBootstrapOperationId,
  resolveMemberQuotaUseInitialQuota,
  serializeMemberQuotaEditorRecovery,
  validateMemberQuotaEditorDraft,
  type MemberQuotaEditorDraft,
  type MemberQuotaEditorOperationState,
} from "./member-quota-editor-state";

export function MemberQuotaEditor({
  context,
}: Readonly<{ context: MemberQuotaBootstrapContext }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<MemberQuotaEditorDraft>(() =>
    initialDraft(context),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [terminal, setTerminal] = useState<{
    message: string;
    status: "success" | "error";
    stale: boolean;
  }>({ message: "", status: "error", stale: false });
  const operation = useRef<MemberQuotaEditorOperationState>({
    fingerprint: null,
    operationId: null,
  });
  const initialQuotaChoice = useRef<boolean | null>(
    context.initialQuota === null ? null : context.usesInitialQuota,
  );
  const [baselineFingerprint, setBaselineFingerprint] = useState(
    memberQuotaEditorDraftFingerprint(initialDraft(context), false),
  );
  const dirty =
    memberQuotaEditorDraftFingerprint(draft, confirmed) !== baselineFingerprint;

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function confirmLinkNavigation(event: MouseEvent) {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link) return;
      if (
        !shouldAllowDirtyNavigation(dirty, () =>
          window.confirm("Discard unsaved member quota changes?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function confirmOtherFormSubmission(event: SubmitEvent) {
      const form = event.target;
      if (
        !dirty ||
        !(form instanceof HTMLFormElement) ||
        form.classList.contains("member-quota-form")
      ) {
        return;
      }
      if (
        !shouldAllowDirtyNavigation(dirty, () =>
          window.confirm("Discard unsaved member quota changes?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmLinkNavigation, true);
    document.addEventListener("submit", confirmOtherFormSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
      document.removeEventListener("submit", confirmOtherFormSubmission, true);
    };
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    let recovery: ReturnType<typeof parseMemberQuotaEditorRecovery> = null;
    try {
      recovery = parseMemberQuotaEditorRecovery(
        window.sessionStorage.getItem(
          memberQuotaEditorRecoveryStorageKeyForMembership(
            context.membershipId,
          ),
        ),
      );
    } catch {
      recovery = null;
    }
    if (!recovery || recovery.membershipId !== context.membershipId) return;
    try {
      window.sessionStorage.removeItem(
        memberQuotaEditorRecoveryStorageKeyForMembership(context.membershipId),
      );
    } catch {
      // In-memory recovery below remains usable when storage is blocked.
    }
    queueMicrotask(() => {
      if (cancelled) return;
      if (recovery.restoreDraft) {
        setDraft(recovery.draft);
      }
      setConfirmed(false);
      setTerminal({
        message: recovery.message ?? "Draft restored. Confirm before retrying.",
        status: "success",
        stale: false,
      });
      operation.current = recovery.operation;
      if (recovery.restoreDraft) {
        initialQuotaChoice.current =
          recovery.draft.initialQuota.trim().length > 0
            ? recovery.draft.useInitialQuota
            : null;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context.membershipId]);
  const settingsReady =
    context.settingsMethod !== null &&
    context.settingsPrecision !== null &&
    context.settingsRoundingRule !== null &&
    context.settingsVersion > 0;

  const preview = useMemo(() => {
    if (!settingsReady) return { projection: null, error: null };
    try {
      return {
        projection: projectMemberQuotaBootstrap({
          adjustmentBands: context.adjustmentBands,
          historyLength: context.settingsHistoryLength,
          initialQuota: draft.initialQuota.trim() || null,
          method: context.settingsMethod,
          precision: context.settingsPrecision,
          seedTotals: draft.seedTotals
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          useInitialQuota:
            draft.initialQuota.trim().length > 0 && draft.useInitialQuota,
        }),
        error: null,
      };
    } catch (error) {
      return {
        projection: null,
        error: error instanceof Error ? error.message : "Review the values.",
      };
    }
  }, [context, draft, settingsReady]);

  function updateDraft<K extends keyof MemberQuotaEditorDraft>(
    key: K,
    value: MemberQuotaEditorDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
    setTerminal({ message: "", status: "error", stale: false });
  }

  function updateSeed(index: number, value: string) {
    updateDraft(
      "seedTotals",
      draft.seedTotals.map((seed, seedIndex) =>
        seedIndex === index ? value : seed,
      ),
    );
  }

  function addSeed() {
    if (draft.seedTotals.length >= MAX_MEMBER_QUOTA_SEEDS) return;
    updateDraft("seedTotals", [...draft.seedTotals, ""]);
  }

  function removeSeed(index: number) {
    updateDraft(
      "seedTotals",
      draft.seedTotals.filter((_, seedIndex) => seedIndex !== index),
    );
  }

  function updateInitialQuota(value: string) {
    if (value.trim().length > 0 && initialQuotaChoice.current === null) {
      initialQuotaChoice.current = true;
    }
    setDraft((current) => ({
      ...current,
      initialQuota: value,
      useInitialQuota: resolveMemberQuotaUseInitialQuota(
        value,
        initialQuotaChoice.current,
      ),
    }));
    setConfirmed(false);
    setTerminal({ message: "", status: "error", stale: false });
  }

  function persistRecovery(
    message: string | null,
    operationState = operation.current,
    recoveryDraft = draft,
    restoreDraft = true,
  ) {
    try {
      window.sessionStorage.setItem(
        memberQuotaEditorRecoveryStorageKeyForMembership(context.membershipId),
        serializeMemberQuotaEditorRecovery({
          draft: recoveryDraft,
          membershipId: context.membershipId,
          message,
          operation: operationState,
          restoreDraft,
        }),
      );
    } catch {
      // Storage is best-effort recovery only.
    }
  }

  function reloadAfterStale() {
    persistRecovery(null, {
      fingerprint: null,
      operationId: null,
    });
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsReady || pending) return;

    const validationError = validateMemberQuotaEditorDraft(draft, confirmed);
    if (validationError) {
      setTerminal({ message: validationError, status: "error", stale: false });
      return;
    }
    if (preview.error || !preview.projection) {
      setTerminal({
        message: preview.error ?? "Review the values before saving.",
        status: "error",
        stale: false,
      });
      return;
    }

    const baseInput = {
      expectedProjectionVersion: context.projectionVersion,
      expectedSettingsVersion: context.settingsVersion,
      initialQuota: draft.initialQuota.trim() || null,
      membershipId: context.membershipId,
      reason: draft.reason.trim(),
      seedTotals: draft.seedTotals.map((value) => value.trim()),
      useInitialQuota:
        draft.initialQuota.trim().length > 0 && draft.useInitialQuota,
    } as const;
    const nextOperation = retainMemberQuotaBootstrapOperationId(
      operation.current,
      baseInput,
      () => crypto.randomUUID(),
    );
    operation.current = nextOperation;
    if (!nextOperation.operationId) {
      setTerminal({
        message: "Could not create a safe operation id. Try again.",
        status: "error",
        stale: false,
      });
      return;
    }

    const input = memberQuotaEditorInput(
      context.membershipId,
      context.projectionVersion,
      context.settingsVersion,
      draft,
      nextOperation.operationId,
    );
    startTransition(async () => {
      try {
        const result = await configureMemberQuotaBootstrapAction(input);
        if (result.ok) {
          operation.current = { fingerprint: null, operationId: null };
          setConfirmed(false);
          setBaselineFingerprint(
            memberQuotaEditorDraftFingerprint(draft, false),
          );
          persistRecovery(
            result.data.projectionReady
              ? "Member quota bootstrap saved."
              : "Member quota inputs saved; the projection needs more history.",
            { fingerprint: null, operationId: null },
            initialDraft(context),
            false,
          );
          setTerminal({
            message: result.data.projectionReady
              ? "Member quota bootstrap saved."
              : "Member quota inputs saved; the projection needs more history.",
            status: "success",
            stale: false,
          });
          router.refresh();
          return;
        }
        if (result.error.code === "stale_version") {
          operation.current = { fingerprint: null, operationId: null };
          setConfirmed(false);
          setTerminal({
            message:
              "Quota settings or this member changed. Reload current values to review the latest context, then confirm again before saving.",
            status: "error",
            stale: true,
          });
          return;
        }
        if (result.error.code === "authentication_required") {
          persistRecovery(null, operation.current);
          router.replace(signInPath("/portal/members"));
          return;
        }
        setTerminal({
          message: result.error.message,
          status: "error",
          stale: false,
        });
      } catch {
        setTerminal({
          message:
            "The member quota service is temporarily unavailable. Try again.",
          status: "error",
          stale: false,
        });
      }
    });
  }

  return (
    <section
      className="member-quota-editor"
      aria-labelledby="member-quota-title"
    >
      <div className="member-quota-editor-heading">
        <div>
          <p className="ledger-kicker">Administrator-only quota setup</p>
          <h2 id="member-quota-title">Quota and seed history</h2>
        </div>
        <span className="member-quota-editor-badge">
          {settingsReady ? "Configured" : "Setup required"}
        </span>
      </div>

      <dl className="member-quota-summary">
        <div>
          <dt>Current quota</dt>
          <dd>{context.projectedQuota ?? "Not ready"}</dd>
        </div>
        <div>
          <dt>Readiness</dt>
          <dd>{context.projectionReady ? "Ready" : "Needs more history"}</dd>
        </div>
        <div>
          <dt>Current provenance</dt>
          <dd>
            {formatProjectionSource(context.projectionSource)}
            {context.projectionEffectiveAt
              ? ` · effective ${new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(context.projectionEffectiveAt))} UTC`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Initial quota</dt>
          <dd>
            {context.initialQuota ?? "Not set"}
            {context.usesInitialQuota ? " · used" : " · not used"}
            {context.initialQuotaProvenance
              ? ` · ${formatInitialQuotaProvenance(context.initialQuotaProvenance)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Settings</dt>
          <dd>{formatSettings(context)}</dd>
        </div>
        <div>
          <dt>Versions</dt>
          <dd>
            projection {context.projectionVersion} · settings{" "}
            {context.settingsVersion}
          </dd>
        </div>
      </dl>

      {!settingsReady ? (
        <p className="member-quota-setup-note">
          Configure the group quota method before editing member quota inputs.{" "}
          <Link href="/portal">Open group quota settings</Link>
        </p>
      ) : null}

      <form className="member-quota-form" onSubmit={submit} noValidate>
        <fieldset disabled={pending || !settingsReady}>
          <legend>Member-owned initial inputs</legend>
          <p className="member-quota-copy">
            Seed totals are ordered setup point totals used by the selected
            quota method; they are not rounds, results, or participation.
          </p>

          <div className="member-quota-form-grid">
            <label className="field-group" htmlFor="member-initial-quota">
              <span>Initial quota (optional)</span>
              <input
                id="member-initial-quota"
                inputMode="decimal"
                type="text"
                value={draft.initialQuota}
                onChange={(event) => updateInitialQuota(event.target.value)}
                aria-describedby="member-initial-quota-help"
              />
              <small id="member-initial-quota-help" className="field-help">
                Use the group precision shown above.
              </small>
            </label>
            <label
              className="member-quota-confirmation"
              htmlFor="member-use-initial"
            >
              <input
                id="member-use-initial"
                type="checkbox"
                checked={draft.useInitialQuota}
                disabled={draft.initialQuota.trim().length === 0}
                onChange={(event) => {
                  initialQuotaChoice.current = event.target.checked;
                  updateDraft("useInitialQuota", event.target.checked);
                }}
              />
              <span>
                Use initial quota until the configured history takes over.
              </span>
            </label>
          </div>

          <div className="member-quota-seed-heading">
            <div>
              <h3>Ordered seed point totals</h3>
              <p className="field-help">
                Oldest first, up to {MAX_MEMBER_QUOTA_SEEDS} values.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={addSeed}
              disabled={draft.seedTotals.length >= MAX_MEMBER_QUOTA_SEEDS}
            >
              Add seed total
            </button>
          </div>
          {draft.seedTotals.length === 0 ? (
            <p className="member-quota-empty-seeds">
              No seed totals yet. Add values when this member has setup history.
            </p>
          ) : (
            <ol
              className="member-quota-seeds"
              aria-label="Ordered seed point totals"
            >
              {draft.seedTotals.map((value, index) => (
                <li key={index}>
                  <label
                    className="field-group"
                    htmlFor={`member-seed-${index}`}
                  >
                    <span>Seed total {index + 1}</span>
                    <input
                      id={`member-seed-${index}`}
                      inputMode="decimal"
                      type="text"
                      value={value}
                      onChange={(event) =>
                        updateSeed(index, event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => removeSeed(index)}
                    aria-label={`Remove seed total ${index + 1}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div
            className="member-quota-preview"
            aria-labelledby="member-quota-preview-title"
          >
            <div>
              <p className="ledger-kicker" id="member-quota-preview-title">
                Exact local preview
              </p>
              <p className="field-help">
                The server recalculates and validates this projection on save.
              </p>
            </div>
            <output aria-live="polite">
              {preview.projection?.quota ?? "Not ready"}
            </output>
            {preview.error ? (
              <p className="field-error">{preview.error}</p>
            ) : null}
          </div>

          <label
            className="field-group member-quota-reason"
            htmlFor="member-quota-reason"
          >
            <span>Reason (required audit note)</span>
            <textarea
              id="member-quota-reason"
              value={draft.reason}
              onChange={(event) => updateDraft("reason", event.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </label>

          <label
            className="member-quota-confirmation"
            htmlFor="member-quota-confirm"
          >
            <input
              id="member-quota-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
            />
            <span>
              I confirm these initial quota inputs and ordered seed totals for
              this member.
            </span>
          </label>

          <button className="primary-button" type="submit">
            {pending ? "Saving…" : "Save quota bootstrap"}
          </button>
        </fieldset>
      </form>

      <div
        className="form-message"
        aria-live="polite"
        data-status={terminal.message ? terminal.status : undefined}
      >
        {terminal.message}
        {terminal.stale ? (
          <button
            className="secondary-button member-quota-reload"
            type="button"
            onClick={reloadAfterStale}
          >
            Reload current values
          </button>
        ) : null}
      </div>
    </section>
  );
}

function initialDraft(
  context: MemberQuotaBootstrapContext,
): MemberQuotaEditorDraft {
  return {
    initialQuota: context.initialQuota ?? "",
    useInitialQuota: context.initialQuota !== null && context.usesInitialQuota,
    seedTotals: [...context.seedTotals]
      .sort((left, right) => left.position - right.position)
      .map((seed) => seed.pointTotal),
    reason: "",
  };
}

function formatProjectionSource(source: Readonly<Record<string, unknown>>) {
  const kind = typeof source.kind === "string" ? source.kind : "not_ready";
  const label = (() => {
    switch (kind) {
      case "initial_quota":
        return "Initial quota";
      case "seed_history":
        return "Seed history";
      case "method_c_chain":
        return "Method C chain";
      case "official_history":
        return "Official history";
      case "manual_override":
        return "Manual override";
      default:
        return "Not ready";
    }
  })();
  const positions = Array.isArray(source.seed_positions)
    ? source.seed_positions.filter(
        (value): value is number =>
          typeof value === "number" && Number.isInteger(value),
      )
    : [];
  return positions.length > 0
    ? `${label} · seed positions ${positions.join(", ")}`
    : label;
}

function formatInitialQuotaProvenance(provenance: string) {
  switch (provenance) {
    case "member_bootstrap":
      return "member bootstrap";
    case "administrator_override":
      return "administrator override";
    default:
      return provenance.replaceAll("_", " ");
  }
}

function formatSettings(context: MemberQuotaBootstrapContext) {
  if (
    context.settingsMethod === null ||
    context.settingsPrecision === null ||
    context.settingsRoundingRule === null
  ) {
    return "Not configured";
  }
  const method =
    context.settingsMethod === "moving_average"
      ? `Moving average${context.settingsHistoryLength ? ` (${context.settingsHistoryLength})` : ""}`
      : context.settingsMethod === "best_10_of_20"
        ? "Best 10 of 20"
        : "Previous plus/minus";
  const bands =
    context.settingsMethod === "previous_plus_minus"
      ? ` · ${context.adjustmentBands.length} adjustment bands`
      : "";
  return `${method} · ${context.settingsPrecision} decimals · half away from zero${bands}`;
}
