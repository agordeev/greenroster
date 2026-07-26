"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { configureQuotaSettingsAction } from "@/app/actions/groups";
import {
  calculateQuota,
  type QuotaAdjustmentBand,
  type QuotaMethod,
} from "@/domain/quota-rules";
import {
  shouldAllowDirtyNavigation,
  validateBandFormRows,
} from "@/lib/groups/quota-settings-form-rules";

export type QuotaSettingsFormValue = Readonly<{
  bands: readonly QuotaAdjustmentBand[];
  historyLength: number | null;
  method: QuotaMethod;
  precision: 0 | 1 | 2;
  version: number;
}>;

type BandRow = QuotaAdjustmentBand & Readonly<{ id: string }>;

const emptyMethodCBands: readonly BandRow[] = [];

export function QuotaSettingsForm({
  identityKey,
  initialValue,
}: Readonly<{
  identityKey: string;
  initialValue: QuotaSettingsFormValue | null;
}>) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const operationPayload = useRef<string | null>(null);
  const operationStorageKey = `greenroster:quota-settings:${identityKey}`;
  const [method, setMethod] = useState<QuotaMethod | null>(
    initialValue?.method ?? null,
  );
  const [historyLength, setHistoryLength] = useState(
    String(initialValue?.historyLength ?? 10),
  );
  const [precision, setPrecision] = useState<0 | 1 | 2 | null>(
    initialValue?.precision ?? null,
  );
  const [bands, setBands] = useState<readonly BandRow[]>(
    initialValue?.bands.length
      ? initialValue.bands.map((band, index) => ({
          ...band,
          id: `stored-band-${index + 1}`,
        }))
      : emptyMethodCBands,
  );
  const [settingsVersion, setSettingsVersion] = useState(
    initialValue?.version ?? 0,
  );
  const [reason, setReason] = useState("");
  const [testPlusMinus, setTestPlusMinus] = useState("0");
  const [testPriorQuota, setTestPriorQuota] = useState("20");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const bandValidation =
    method === "previous_plus_minus"
      ? validateBandFormRows(bands)
      : { rowErrors: [], summary: null };
  const bandError = bandValidation.summary;
  const preview =
    method === "previous_plus_minus" && !bandError && precision !== null
      ? quotaPreview(bands, testPriorQuota, testPlusMinus, precision)
      : null;
  const parsedHistoryLength = Number(historyLength);
  const historyError =
    method === "moving_average" &&
    (!Number.isInteger(parsedHistoryLength) ||
      parsedHistoryLength < 4 ||
      parsedHistoryLength > 20)
      ? "History length must be a whole number from 4 through 20."
      : null;
  const baseline = settingsFingerprint(initialValue);
  const currentFingerprint = JSON.stringify({
    bands: bands.map(withoutBandId),
    historyLength: method === "moving_average" ? historyLength : null,
    method,
    precision,
    reason,
  });
  const dirty = currentFingerprint !== baseline;
  const methodExample =
    method !== null && method !== "previous_plus_minus" && precision !== null
      ? quotaMethodExample(method, parsedHistoryLength, precision)
      : null;

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
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
          window.confirm("Discard unsaved quota settings changes?"),
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
        form.classList.contains("quota-settings-form")
      ) {
        return;
      }
      if (
        !shouldAllowDirtyNavigation(dirty, () =>
          window.confirm("Discard unsaved quota settings changes?"),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("click", confirmLinkNavigation, true);
    document.addEventListener("submit", confirmOtherFormSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
      document.removeEventListener("submit", confirmOtherFormSubmission, true);
    };
  }, [dirty]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (method === null || precision === null) {
      setMessage("Choose a calculation method and quota precision.");
      return;
    }
    const payload = {
      bands: method === "previous_plus_minus" ? bands.map(withoutBandId) : [],
      expectedSettingsVersion: settingsVersion,
      historyLength: method === "moving_average" ? parsedHistoryLength : null,
      method,
      precision,
      reason,
      roundingRule: "half_away_from_zero" as const,
    };
    const serializedPayload = JSON.stringify(payload);
    if (operationPayload.current !== serializedPayload) {
      const storedOperation = readStoredOperation(operationStorageKey);
      operationId.current =
        storedOperation?.payload === serializedPayload &&
        isUuid(storedOperation.operationId)
          ? storedOperation.operationId
          : crypto.randomUUID();
      operationPayload.current = serializedPayload;
      writeStoredOperation(operationStorageKey, {
        operationId: operationId.current,
        payload: serializedPayload,
      });
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof configureQuotaSettingsAction>>;
      try {
        result = await configureQuotaSettingsAction({
          ...payload,
          operationId: operationId.current,
        });
      } catch {
        setMessage("The service is temporarily unavailable. Try again.");
        return;
      }

      if (!result.ok) {
        setMessage(result.error.message);
        if (result.error.code === "stale_version") {
          operationId.current = null;
          operationPayload.current = null;
          router.refresh();
        }
        return;
      }

      operationId.current = null;
      operationPayload.current = null;
      removeStoredOperation(operationStorageKey);
      setSettingsVersion(result.data.settingsVersion);
      setReason("");
      setMessage("Quota rules saved. New rounds will use this policy.");
      router.refresh();
    });
  }

  function updateBand(index: number, patch: Partial<QuotaAdjustmentBand>) {
    setBands((current) =>
      current.map((band, bandIndex) =>
        bandIndex === index ? { ...band, ...patch } : band,
      ),
    );
  }

  function cancelChanges() {
    setMethod(initialValue?.method ?? null);
    setHistoryLength(String(initialValue?.historyLength ?? 10));
    setPrecision(initialValue?.precision ?? null);
    setSettingsVersion(initialValue?.version ?? 0);
    setBands(
      initialValue?.bands.length
        ? initialValue.bands.map((band, index) => ({
            ...band,
            id: `stored-band-${index + 1}`,
          }))
        : emptyMethodCBands,
    );
    setReason("");
    setMessage("");
    operationId.current = null;
    operationPayload.current = null;
    removeStoredOperation(operationStorageKey);
  }

  function moveBand(index: number, direction: -1 | 1) {
    setBands((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <form
      className="quota-settings-form"
      onSubmit={submit}
      aria-busy={pending}
      noValidate
    >
      <fieldset className="quota-methods">
        <legend>Calculation method</legend>
        {(
          [
            [
              "moving_average",
              "A",
              "Moving average",
              "Average the most recent eligible totals.",
            ],
            [
              "best_10_of_20",
              "B",
              "Best 10 of 20",
              "Use the ten highest totals from the latest twenty.",
            ],
            [
              "previous_plus_minus",
              "C",
              "Previous plus/minus",
              "Advance the prior quota through an adjustment band.",
            ],
          ] as const
        ).map(([value, letter, label, detail]) => (
          <label key={value} data-selected={method === value}>
            <input
              type="radio"
              name="quotaMethod"
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
            />
            <span aria-hidden="true">{letter}</span>
            <strong>{label}</strong>
            <small>{detail}</small>
          </label>
        ))}
      </fieldset>

      <div className="quota-policy-row">
        {method === "moving_average" ? (
          <label className="field-group">
            <span>Eligible history length</span>
            <input
              type="number"
              min="4"
              max="20"
              step="1"
              value={historyLength}
              onChange={(event) => setHistoryLength(event.target.value)}
              aria-invalid={Boolean(historyError)}
              aria-describedby={
                historyError ? "quota-history-error" : undefined
              }
              required
            />
            <small>Choose 4–20; the default is 10.</small>
            {historyError ? (
              <small className="field-error" id="quota-history-error">
                {historyError}
              </small>
            ) : null}
          </label>
        ) : (
          <p className="quota-policy-note">
            {method === "best_10_of_20"
              ? "History is fixed at the latest 20 eligible totals."
              : "Every allowed plus/minus value must belong to exactly one band."}
          </p>
        )}
        <fieldset className="precision-options">
          <legend>Quota precision</legend>
          {([0, 1, 2] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="precision"
                checked={precision === value}
                onChange={() => setPrecision(value)}
              />
              {value} {value === 1 ? "decimal" : "decimals"}
            </label>
          ))}
          <small>Exact halves round away from zero.</small>
        </fieldset>
      </div>

      {methodExample ? (
        <div className="quota-rule-example">
          <p className="ledger-kicker">Example effect</p>
          <p>{methodExample}</p>
        </div>
      ) : null}

      {method === "previous_plus_minus" ? (
        <section className="band-editor" aria-labelledby="band-editor-title">
          <div className="band-editor-heading">
            <div>
              <h3 id="band-editor-title">Adjustment band ledger</h3>
              <p>Rows are evaluated in order from −100 through 100.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setBands((current) => [
                  ...current,
                  {
                    adjustment: "",
                    id: crypto.randomUUID(),
                    lowerBound: "",
                    lowerInclusive: false,
                    upperBound: "",
                    upperInclusive: false,
                  },
                ])
              }
            >
              Add band
            </button>
          </div>
          {bands.map((band, index) => (
            <fieldset className="band-row" key={band.id}>
              <legend>Band {index + 1}</legend>
              <label>
                Lower
                <input
                  aria-label={`Band ${index + 1} lower bound`}
                  aria-invalid={Boolean(bandValidation.rowErrors[index])}
                  aria-describedby={
                    bandValidation.rowErrors[index]
                      ? `quota-band-${index + 1}-error`
                      : undefined
                  }
                  value={band.lowerBound}
                  onChange={(event) =>
                    updateBand(index, { lowerBound: event.target.value })
                  }
                  inputMode="decimal"
                />
              </label>
              <label className="bound-choice">
                <input
                  type="checkbox"
                  checked={band.lowerInclusive}
                  aria-invalid={Boolean(bandValidation.rowErrors[index])}
                  aria-describedby={
                    bandValidation.rowErrors[index]
                      ? `quota-band-${index + 1}-error`
                      : undefined
                  }
                  onChange={(event) =>
                    updateBand(index, { lowerInclusive: event.target.checked })
                  }
                />
                Include lower
              </label>
              <label>
                Upper
                <input
                  aria-label={`Band ${index + 1} upper bound`}
                  aria-invalid={Boolean(bandValidation.rowErrors[index])}
                  aria-describedby={
                    bandValidation.rowErrors[index]
                      ? `quota-band-${index + 1}-error`
                      : undefined
                  }
                  value={band.upperBound}
                  onChange={(event) =>
                    updateBand(index, { upperBound: event.target.value })
                  }
                  inputMode="decimal"
                />
              </label>
              <label className="bound-choice">
                <input
                  type="checkbox"
                  checked={band.upperInclusive}
                  aria-invalid={Boolean(bandValidation.rowErrors[index])}
                  aria-describedby={
                    bandValidation.rowErrors[index]
                      ? `quota-band-${index + 1}-error`
                      : undefined
                  }
                  onChange={(event) =>
                    updateBand(index, { upperInclusive: event.target.checked })
                  }
                />
                Include upper
              </label>
              <label>
                Adjustment
                <input
                  aria-label={`Band ${index + 1} quota adjustment`}
                  aria-invalid={Boolean(bandValidation.rowErrors[index])}
                  aria-describedby={
                    bandValidation.rowErrors[index]
                      ? `quota-band-${index + 1}-error`
                      : undefined
                  }
                  value={band.adjustment}
                  onChange={(event) =>
                    updateBand(index, { adjustment: event.target.value })
                  }
                  inputMode="decimal"
                />
              </label>
              <div className="band-actions">
                <button
                  type="button"
                  onClick={() => moveBand(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move band ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveBand(index, 1)}
                  disabled={index === bands.length - 1}
                  aria-label={`Move band ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBands((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={bands.length === 1}
                >
                  Remove
                </button>
              </div>
              {bandValidation.rowErrors[index] ? (
                <p
                  className="field-error band-row-error"
                  id={`quota-band-${index + 1}-error`}
                >
                  {bandValidation.rowErrors[index]}
                </p>
              ) : null}
            </fieldset>
          ))}
          {bands.length === 0 && bandError ? (
            <p className="field-error">{bandError}</p>
          ) : null}
          <div className="quota-test">
            <div>
              <p className="ledger-kicker">Test the rule</p>
              <h3>Projected next quota</h3>
            </div>
            <label>
              Prior quota
              <input
                value={testPriorQuota}
                onChange={(event) => setTestPriorQuota(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Plus/minus
              <input
                value={testPlusMinus}
                onChange={(event) => setTestPlusMinus(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <output
              aria-live="polite"
              aria-label="Selected band and projected next quota preview"
            >
              {preview ?? "—"}
            </output>
            <small>
              Preview only. The server remains authoritative when rules are
              saved.
            </small>
          </div>
        </section>
      ) : null}

      <label className="field-group quota-reason">
        <span>Reason for change</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          required
        />
        <small>Stored with the settings audit record.</small>
      </label>
      <p
        className="form-message"
        aria-live="polite"
        role={message ? "alert" : undefined}
      >
        {message}
      </p>
      <p
        className="quota-validation-summary"
        id="quota-save-summary"
        role={bandError || historyError ? "alert" : undefined}
      >
        {bandError
          ? `Cannot save: ${bandError}`
          : historyError
            ? `Cannot save: ${historyError}`
            : ""}
      </p>
      <div className="quota-form-actions">
        <button
          className="primary-button"
          type="submit"
          aria-describedby={
            bandError || historyError ? "quota-save-summary" : undefined
          }
          disabled={
            pending ||
            method === null ||
            precision === null ||
            Boolean(historyError) ||
            Boolean(bandError) ||
            reason.trim().length === 0
          }
        >
          {pending ? "Saving quota rules…" : "Save quota rules"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={cancelChanges}
          disabled={pending || !dirty}
        >
          Cancel changes
        </button>
      </div>
    </form>
  );
}

function withoutBandId(band: BandRow): QuotaAdjustmentBand {
  return {
    adjustment: band.adjustment,
    lowerBound: band.lowerBound,
    lowerInclusive: band.lowerInclusive,
    upperBound: band.upperBound,
    upperInclusive: band.upperInclusive,
  };
}

function settingsFingerprint(value: QuotaSettingsFormValue | null) {
  return JSON.stringify({
    bands: value?.bands ?? [],
    historyLength:
      (value?.method ?? "moving_average") === "moving_average"
        ? String(value?.historyLength ?? 10)
        : null,
    method: value?.method ?? null,
    precision: value?.precision ?? null,
    reason: "",
  });
}

function quotaPreview(
  bands: readonly QuotaAdjustmentBand[],
  priorQuota: string,
  plusMinus: string,
  precision: 0 | 1 | 2,
) {
  try {
    const result = calculateQuota({
      adjustmentBands: bands,
      eligiblePointTotals: [],
      method: "previous_plus_minus",
      plusMinus,
      precision,
      previousQuota: priorQuota,
      useInitialQuota: false,
    });
    return result.ready
      ? `Band ${result.matchedBandPosition} · ${result.quota}`
      : "Initial quota required";
  } catch {
    return "Invalid test values";
  }
}

function quotaMethodExample(
  method: Exclude<QuotaMethod, "previous_plus_minus">,
  historyLength: number,
  precision: 0 | 1 | 2,
) {
  try {
    const totals =
      method === "moving_average"
        ? Array.from({ length: historyLength }, (_, index) =>
            String(18 + index),
          )
        : Array.from({ length: 20 }, (_, index) => String(index + 1));
    const result = calculateQuota({
      eligiblePointTotals: totals,
      ...(method === "moving_average" ? { historyLength } : {}),
      method,
      precision,
      useInitialQuota: false,
    });
    return result.ready
      ? `With sample eligible totals, this policy produces a ${result.quota} quota.`
      : null;
  } catch {
    return null;
  }
}

type StoredOperation = Readonly<{ operationId: string; payload: string }>;

function readStoredOperation(key: string): StoredOperation | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "operationId" in parsed &&
      typeof parsed.operationId === "string" &&
      "payload" in parsed &&
      typeof parsed.payload === "string"
    ) {
      return { operationId: parsed.operationId, payload: parsed.payload };
    }
  } catch {
    // In-memory retry remains available when browser storage is blocked.
  }
  return null;
}

function writeStoredOperation(key: string, value: StoredOperation) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // In-memory retry remains available when browser storage is blocked.
  }
}

function removeStoredOperation(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear when browser storage is blocked.
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
