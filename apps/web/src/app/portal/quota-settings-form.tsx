"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { configureQuotaSettingsAction } from "@/app/actions/groups";
import {
  calculateQuota,
  type PlacementMeritRow,
  type QuotaAdjustmentBand,
  type QuotaMethod,
  validateParticipationMerit,
  validatePlacementMeritRows,
  validateStandingsResetDate,
} from "@/domain/quota-rules";
import {
  shouldAllowDirtyNavigation,
  validateBandFormRows,
} from "@/lib/groups/quota-settings-form-rules";

export type QuotaSettingsFormValue = Readonly<{
  bands: readonly QuotaAdjustmentBand[];
  historyLength: number | null;
  method: QuotaMethod;
  participationMerit: string;
  placementMerit: readonly PlacementMeritRow[];
  precision: 0 | 1 | 2;
  standingsResetDate: string | null;
  version: number;
}>;

type BandRow = QuotaAdjustmentBand & Readonly<{ id: string }>;
type PlacementRow = PlacementMeritRow & Readonly<{ id: string }>;

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
  const [participationMerit, setParticipationMerit] = useState(
    initialValue?.participationMerit ?? "0",
  );
  const [placementMerit, setPlacementMerit] = useState<readonly PlacementRow[]>(
    initialValue?.placementMerit.map((row) => ({
      ...row,
      id: `stored-placement-${row.rank}`,
    })) ?? [],
  );
  const [standingsResetDate, setStandingsResetDate] = useState(
    initialValue?.standingsResetDate ?? "",
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
      ? "Enter a whole number from 4 through 20."
      : null;
  const participationMeritError = meritValidationError(() =>
    validateParticipationMerit(participationMerit),
  );
  const placementMeritError = meritValidationError(() =>
    validatePlacementMeritRows(placementMerit),
  );
  const standingsResetDateError = meritValidationError(() =>
    validateStandingsResetDate(standingsResetDate || null),
  );
  const meritError =
    participationMeritError || placementMeritError || standingsResetDateError;
  const baseline = settingsFingerprint(initialValue);
  const currentFingerprint = JSON.stringify({
    bands: bands.map(withoutBandId),
    historyLength: method === "moving_average" ? historyLength : null,
    method,
    participationMerit,
    placementMerit: placementMerit.map(withoutPlacementId),
    precision,
    reason,
    standingsResetDate: standingsResetDate || null,
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
          window.confirm("Discard your unsaved changes to the quota rules?"),
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
          window.confirm("Discard your unsaved changes to the quota rules?"),
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
      setMessage(
        "Choose a calculation method and the number of quota decimal places.",
      );
      return;
    }
    const payload = {
      bands: method === "previous_plus_minus" ? bands.map(withoutBandId) : [],
      expectedSettingsVersion: settingsVersion,
      historyLength: method === "moving_average" ? parsedHistoryLength : null,
      method,
      participationMerit: participationMerit.trim(),
      placementMerit: placementMerit.map(withoutPlacementId),
      precision,
      reason,
      roundingRule: "half_away_from_zero" as const,
      standingsResetDate: standingsResetDate.trim() || null,
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
        setMessage("We couldn't save your quota rules. Try again.");
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
      setMessage(
        "Quota and merit rules saved. They apply to rounds you publish from now on.",
      );
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
    setParticipationMerit(initialValue?.participationMerit ?? "0");
    setPlacementMerit(
      initialValue?.placementMerit.map((row) => ({
        ...row,
        id: `stored-placement-${row.rank}`,
      })) ?? [],
    );
    setStandingsResetDate(initialValue?.standingsResetDate ?? "");
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
              "The average of a member's most recent point totals.",
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
              "Move the previous quota up or down by a set amount, based on the member's plus/minus.",
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
            <span>Rounds to average</span>
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
            <small>From 4 to 20.</small>
            {historyError ? (
              <small className="field-error" id="quota-history-error">
                {historyError}
              </small>
            ) : null}
          </label>
        ) : (
          <p className="quota-policy-note">
            {method === "best_10_of_20"
              ? "Always uses the latest 20 point totals."
              : method === "previous_plus_minus"
                ? "Every plus/minus value must fall in exactly one band."
                : "Choose a calculation method to see its options."}
          </p>
        )}
        <fieldset className="precision-options">
          <legend>Quota decimal places</legend>
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
        </fieldset>
      </div>

      <section
        className="merit-settings"
        aria-labelledby="merit-settings-title"
      >
        <div className="band-editor-heading">
          <div>
            <p className="ledger-kicker">Merit and standings</p>
            <h3 id="merit-settings-title">
              Set how Order of Merit points are awarded
            </h3>
            <p>
              Every member who plays gets participation points. You can also
              award points by finishing place. Tied players each get the points
              for their place.
            </p>
          </div>
        </div>
        <div className="quota-policy-row">
          <label className="field-group">
            <span>Participation merit</span>
            <input
              value={participationMerit}
              onChange={(event) => setParticipationMerit(event.target.value)}
              inputMode="decimal"
              aria-invalid={Boolean(participationMeritError)}
              aria-describedby={
                participationMeritError
                  ? "participation-merit-error"
                  : undefined
              }
              required
            />
            <small>Enter 0 for no participation points.</small>
            {participationMeritError ? (
              <small className="field-error" id="participation-merit-error">
                {participationMeritError}
              </small>
            ) : null}
          </label>
          <label className="field-group">
            <span>Standings reset date</span>
            <input
              type="date"
              value={standingsResetDate}
              onChange={(event) => setStandingsResetDate(event.target.value)}
              aria-invalid={Boolean(standingsResetDateError)}
              aria-describedby={
                standingsResetDateError
                  ? "standings-reset-date-error"
                  : undefined
              }
            />
            <small>
              Results before this date don&apos;t count toward standings. Leave
              it blank to count every result.
            </small>
            {standingsResetDateError ? (
              <small className="field-error" id="standings-reset-date-error">
                {standingsResetDateError}
              </small>
            ) : null}
          </label>
        </div>
        <div className="band-editor-heading">
          <div>
            <h4>Points by finishing place</h4>
            <p>
              List ranks in order, lowest first. Leave the table empty to award
              no placement points.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              setPlacementMerit((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  points: "",
                  rank: current.length
                    ? (current.at(-1)?.rank ?? current.length) + 1
                    : 1,
                },
              ])
            }
          >
            Add placement
          </button>
        </div>
        {placementMerit.map((row, index) => (
          <fieldset className="band-row" key={row.id}>
            <legend>Placement rank {index + 1}</legend>
            <label>
              Rank
              <input
                type="number"
                min="1"
                step="1"
                value={row.rank}
                aria-label={`Placement row ${index + 1} rank`}
                aria-invalid={Boolean(placementMeritError)}
                onChange={(event) =>
                  setPlacementMerit((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, rank: Number(event.target.value) }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              Merit points
              <input
                value={row.points}
                inputMode="decimal"
                aria-label={`Placement row ${index + 1} merit points`}
                aria-invalid={Boolean(placementMeritError)}
                onChange={(event) =>
                  setPlacementMerit((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, points: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setPlacementMerit((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            >
              Remove
            </button>
          </fieldset>
        ))}
        {placementMeritError ? (
          <p className="field-error" role="alert">
            {placementMeritError}
          </p>
        ) : null}
      </section>

      {methodExample ? (
        <div className="quota-rule-example">
          <p className="ledger-kicker">Example</p>
          <p>{methodExample}</p>
        </div>
      ) : null}

      {method === "previous_plus_minus" ? (
        <section className="band-editor" aria-labelledby="band-editor-title">
          <div className="band-editor-heading">
            <div>
              <h3 id="band-editor-title">Adjustment bands</h3>
              <p>Bands are checked in the order listed, from −100 to 100.</p>
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
              Previous quota
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
              aria-label="Matching band and projected next quota"
            >
              {preview ?? "—"}
            </output>
            <small>This is only a preview.</small>
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
        role={bandError || historyError || meritError ? "alert" : undefined}
      >
        {bandError
          ? `Can't save yet: ${bandError}`
          : historyError
            ? `Can't save yet: ${historyError}`
            : meritError
              ? `Can't save yet: ${meritError}`
              : ""}
      </p>
      <div className="quota-form-actions">
        <button
          className="primary-button"
          type="submit"
          aria-describedby={
            bandError || historyError || meritError
              ? "quota-save-summary"
              : undefined
          }
          disabled={
            pending ||
            method === null ||
            precision === null ||
            Boolean(historyError) ||
            Boolean(bandError) ||
            Boolean(meritError) ||
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

function withoutPlacementId(row: PlacementRow): PlacementMeritRow {
  return { rank: row.rank, points: row.points };
}

function settingsFingerprint(value: QuotaSettingsFormValue | null) {
  return JSON.stringify({
    bands: value?.bands ?? [],
    historyLength:
      (value?.method ?? "moving_average") === "moving_average"
        ? String(value?.historyLength ?? 10)
        : null,
    method: value?.method ?? null,
    participationMerit: value?.participationMerit ?? "0",
    placementMerit: value?.placementMerit ?? [],
    precision: value?.precision ?? null,
    reason: "",
    standingsResetDate: value?.standingsResetDate ?? null,
  });
}

function meritValidationError(validate: () => void): string | null {
  try {
    validate();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Review this setting.";
  }
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
      : "Enter a previous quota to test.";
  } catch {
    return "Enter valid numbers to test.";
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
      ? `With sample totals, this method gives a ${result.quota} quota.`
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
