"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { configureMemberQuotaBootstrapAction } from "@/app/actions/memberships";
import {
  FieldError,
  FieldHelp,
  FormMessage,
  Kicker,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
        form.dataset.form === "member-quota-form"
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
        message:
          recovery.message ??
          "Your unsaved changes are back. Confirm again before you save.",
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
        error: error instanceof Error ? error.message : "Check the values.",
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
        message: preview.error ?? "Check the values before saving.",
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
        message: "We couldn't save your changes. Try again.",
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
              ? "Starting quota saved."
              : "Starting quota saved. The quota needs more history before it can be calculated.",
            { fingerprint: null, operationId: null },
            initialDraft(context),
            false,
          );
          setTerminal({
            message: result.data.projectionReady
              ? "Starting quota saved."
              : "Starting quota saved. The quota needs more history before it can be calculated.",
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
              "The quota rules or this member's details have changed. Reload to see the latest, then confirm again before saving.",
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
          message: "We couldn't save your changes. Try again.",
          status: "error",
          stale: false,
        });
      }
    });
  }

  return (
    <section
      className="mt-8 grid max-w-184 gap-6"
      aria-labelledby="member-quota-title"
    >
      <div className="pb-4 gap-4 border-b border-b-border/50 flex items-start justify-between [&_h2]:mx-0 [&_h2]:mt-[0.35rem] [&_h2]:mb-0 [&_h2]:font-semibold [&_h2]:text-[1.5rem]">
        <h2 id="member-quota-title">Starting quota and earlier totals</h2>
        <span className="text-primary font-mono text-[0.6875rem] font-bold tracking-[0.08em] uppercase">
          {settingsReady ? "Ready" : "Needs setup"}
        </span>
      </div>

      <dl className="m-0 pb-5 gap-4 border-b border-b-border/50 grid grid-cols-3 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-[0.35rem] [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[0.8125rem] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
        <div>
          <dt>Current quota</dt>
          <dd>{context.projectedQuota ?? "Not ready"}</dd>
        </div>
        <div>
          <dt>Readiness</dt>
          <dd>{context.projectionReady ? "Ready" : "Needs more history"}</dd>
        </div>
        <div>
          <dt>Based on</dt>
          <dd>
            {formatProjectionSource(context.projectionSource)}
            {context.projectionEffectiveAt
              ? ` · effective ${new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(context.projectionEffectiveAt))}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Starting quota</dt>
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
      </dl>

      {!settingsReady ? (
        <p className="m-0 p-4 border-l-[0.25rem] border-l-destructive leading-[1.55] bg-border text-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline-offset-[0.2em]">
          Choose your group&apos;s quota rules before you set a member&apos;s
          starting quota. <Link href="/portal/quota">Open quota rules</Link>
        </p>
      ) : null}

      <form
        className="gap-5 grid [&>fieldset]:m-0 [&>fieldset]:p-0 [&>fieldset]:gap-5 [&>fieldset]:border-0 [&>fieldset]:grid [&>fieldset]:min-w-0 [&_legend]:mb-1 [&_legend]:text-[1.125rem] [&_legend]:font-semibold"
        data-form="member-quota-form"
        onSubmit={submit}
        noValidate
      >
        <fieldset disabled={pending || !settingsReady}>
          <legend>Starting quota for this member</legend>
          <p className="m-0 text-muted-foreground leading-[1.55]">
            Seed totals are starting point totals, entered oldest first, that
            the group&apos;s quota method uses.
          </p>

          <div className="gap-4 grid grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] items-start max-[720px]:grid-cols-[1fr]">
            <label
              className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
              data-slot="field"
              htmlFor="member-initial-quota"
            >
              <span>Starting quota (optional)</span>
              <Input
                id="member-initial-quota"
                inputMode="decimal"
                type="text"
                value={draft.initialQuota}
                onChange={(event) => updateInitialQuota(event.target.value)}
                aria-describedby="member-initial-quota-help"
              />
              <small
                id="member-initial-quota-help"
                className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
                data-slot="field-help"
              >
                Enter it with the decimal places shown above.
              </small>
            </label>
            <label
              className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] leading-[1.45]"
              htmlFor="member-use-initial"
            >
              <Checkbox
                id="member-use-initial"
                checked={draft.useInitialQuota}
                disabled={draft.initialQuota.trim().length === 0}
                onCheckedChange={(checked) => {
                  initialQuotaChoice.current = checked === true;
                  updateDraft("useInitialQuota", checked === true);
                }}
              />
              <span>
                Use this starting quota until enough history builds up.
              </span>
            </label>
          </div>

          <div className="pt-5 gap-4 border-t border-t-border/50 flex justify-between items-end max-[720px]:items-start max-[720px]:flex-col [&_[data-slot=field-help]]:mx-0 [&_[data-slot=field-help]]:mt-[0.3rem] [&_[data-slot=field-help]]:mb-0 [&_h3]:mx-0 [&_h3]:mt-[0.35rem] [&_h3]:mb-0 [&_h3]:font-semibold [&_h3]:text-[1.125rem]">
            <div>
              <h3>Seed point totals</h3>
              <FieldHelp>
                Oldest first. Up to {MAX_MEMBER_QUOTA_SEEDS} values.
              </FieldHelp>
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={addSeed}
              disabled={draft.seedTotals.length >= MAX_MEMBER_QUOTA_SEEDS}
            >
              Add seed total
            </Button>
          </div>
          {draft.seedTotals.length === 0 ? (
            <p className="m-0 text-muted-foreground leading-[1.55]">
              No seed totals yet. Add them if this member has earlier history.
            </p>
          ) : (
            <ol
              className="m-0 p-0 gap-3 grid list-none [counter-reset:member-seed] [&_:is([data-slot=field],[data-slot='field'])]:min-w-0 [&_li::before]:[content:''] [&_li::before]:hidden! [&_li]:py-[0.9rem] [&_li]:px-4 [&_li]:gap-3 [&_li]:border [&_li]:border-border/50 [&_li]:grid [&_li]:grid-cols-[minmax(0,1fr)_auto] [&_li]:items-end [&_li]:bg-card [&_li]:[counter-increment:member-seed] max-[720px]:[&_li]:grid-cols-[1fr]!"
              aria-label="Seed point totals"
            >
              {draft.seedTotals.map((value, index) => (
                <li key={index}>
                  <label
                    className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                    data-slot="field"
                    htmlFor={`member-seed-${index}`}
                  >
                    <span>Seed total {index + 1}</span>
                    <Input
                      id={`member-seed-${index}`}
                      inputMode="decimal"
                      type="text"
                      value={value}
                      onChange={(event) =>
                        updateSeed(index, event.target.value)
                      }
                    />
                  </label>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => removeSeed(index)}
                    aria-label={`Remove seed total ${index + 1}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}

          <div
            className="p-4 border-y grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-3 gap-x-4 max-[720px]:grid-cols-[1fr] [&_[data-slot=field-error]]:col-span-full [&_output]:min-w-20 [&_output]:text-primary [&_output]:text-[2rem] [&_output]:text-right max-[720px]:[&_output]:text-left! [&_p]:m-0"
            aria-labelledby="member-quota-preview-title"
          >
            <div>
              <Kicker id="member-quota-preview-title">Preview</Kicker>
            </div>
            <output aria-live="polite">
              {preview.projection?.quota ?? "Not ready"}
            </output>
            {preview.error ? <FieldError>{preview.error}</FieldError> : null}
          </div>

          <label
            className="gap-2 grid max-w-152 [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor="member-quota-reason"
          >
            <span>Reason (required)</span>
            <Textarea
              id="member-quota-reason"
              value={draft.reason}
              onChange={(event) => updateDraft("reason", event.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </label>

          <label
            className="gap-2 flex items-start text-muted-foreground text-[0.8125rem] leading-[1.45]"
            htmlFor="member-quota-confirm"
          >
            <Checkbox
              id="member-quota-confirm"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              required
            />
            <span>
              I confirm these starting quota values and seed totals for this
              member.
            </span>
          </label>

          <Button type="submit">
            {pending ? "Saving…" : "Save starting quota"}
          </Button>
        </fieldset>
      </form>

      <FormMessage
        tone={terminal.status === "success" ? "success" : "error"}
        aria-live="polite"
        data-status={terminal.message ? terminal.status : undefined}
      >
        {terminal.message || null}
        {terminal.message && terminal.stale ? (
          <Button
            variant="outline"
            className="member-quota-reload"
            type="button"
            onClick={reloadAfterStale}
          >
            Reload current values
          </Button>
        ) : null}
      </FormMessage>
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
        return "Starting quota";
      case "seed_history":
        return "Seed history";
      case "method_c_chain":
        return "Previous plus/minus adjustments";
      case "official_history":
        return "From official results";
      case "manual_override":
        return "Set by an administrator";
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
    ? `${label} · seeds ${positions.join(", ")}`
    : label;
}

function formatInitialQuotaProvenance(provenance: string) {
  switch (provenance) {
    case "member_bootstrap":
      return "entered for this member";
    case "administrator_override":
      return "set by an administrator";
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
    return "Not set";
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
  return `${method} · ${context.settingsPrecision} decimals · halves round away from zero${bands}`;
}
