"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  EmptyState,
  Field,
  FieldError,
  FieldHelp,
  FormMessage,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  QUOTA_CALCULATOR_MAX_ROUNDS,
  calculateFromForm,
  defaultQuotaCalculatorForm,
  parseCalculatorQuery,
  toCalculatorQuery,
  type QuotaCalculatorForm,
  type QuotaCalculatorMethod,
  type QuotaCalculatorOutcome,
} from "@/domain/quota-calculator-input";

const STARTING_ROWS = 4;

type Row = Readonly<{ id: number; value: string }>;

function rowsFor(points: readonly string[]): Row[] {
  const values = [...points];
  while (values.length < STARTING_ROWS) values.push("");
  return values.map((value, id) => ({ id, value }));
}

const subscribeToNothing = () => () => {};

// A shared address carries the numbers. The page itself is static, so they are
// read here, in the browser, once it has loaded; the form then starts again
// from them.
export function QuotaCalculator() {
  const search = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    () => "",
  );

  return (
    <QuotaCalculatorForm
      key={search}
      initial={
        search ? parseCalculatorQuery(search) : defaultQuotaCalculatorForm
      }
    />
  );
}

function QuotaCalculatorForm({
  initial,
}: Readonly<{ initial: QuotaCalculatorForm }>) {
  const [method, setMethod] = useState(initial.method);
  const [roundsCounted, setRoundsCounted] = useState(initial.roundsCounted);
  const [startingQuota, setStartingQuota] = useState(initial.startingQuota);
  const [rows, setRows] = useState<Row[]>(() => rowsFor(initial.points));
  const [outcome, setOutcome] = useState<QuotaCalculatorOutcome | null>(() =>
    initial.points.length > 0 || initial.startingQuota
      ? calculateFromForm(initial)
      : null,
  );
  const nextRowId = useRef(Math.max(initial.points.length, STARTING_ROWS));
  const lastRowRef = useRef<HTMLInputElement>(null);
  const focusLastRow = useRef(false);

  useEffect(() => {
    if (!focusLastRow.current) return;
    focusLastRow.current = false;
    lastRowRef.current?.focus();
  }, [rows.length]);

  const form: QuotaCalculatorForm = {
    method,
    points: rows.map((row) => row.value),
    roundsCounted,
    startingQuota,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome(calculateFromForm(form));
    window.history.replaceState(null, "", `?${toCalculatorQuery(form)}`);
  }

  function addRow() {
    focusLastRow.current = true;
    setRows((current) => [...current, { id: nextRowId.current++, value: "" }]);
  }

  const error = outcome?.status === "invalid" ? outcome.message : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="gap-0 border-t-[3px] border-t-primary p-[clamp(1.25rem,3vw,2rem)]">
        <form
          className="grid gap-6 max-[480px]:[&_button[type=submit]]:w-full"
          onSubmit={submit}
          noValidate
        >
          <div className="grid items-start gap-6 sm:grid-cols-2">
            <Field id="quota-method" label="Method">
              <NativeSelect
                id="quota-method"
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as QuotaCalculatorMethod)
                }
              >
                <NativeSelectOption value="moving_average">
                  Moving average
                </NativeSelectOption>
                <NativeSelectOption value="best_10_of_20">
                  Best 10 of 20
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            {method === "moving_average" ? (
              <Field
                id="quota-rounds-counted"
                label="Rounds counted"
                help="From 4 to 20. Your latest rounds count."
              >
                <Input
                  id="quota-rounds-counted"
                  type="number"
                  inputMode="numeric"
                  min="4"
                  max="20"
                  step="1"
                  value={roundsCounted}
                  onChange={(event) => setRoundsCounted(event.target.value)}
                />
              </Field>
            ) : (
              <FieldHelp className="sm:pt-9">
                Your ten highest totals from your latest 20 rounds count.
              </FieldHelp>
            )}
          </div>

          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className="mb-1 p-0">Points from each round</legend>
            <FieldHelp>
              Type your points total for each round, oldest first. Add up to{" "}
              {QUOTA_CALCULATOR_MAX_ROUNDS} rounds.
            </FieldHelp>
            <ol className="m-0 grid list-none gap-x-6 gap-y-3 p-0 sm:grid-cols-2">
              {rows.map((row, index) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <label
                    className="font-mono text-xs font-medium text-muted-foreground"
                    htmlFor={`quota-round-${row.id}`}
                  >
                    Round {index + 1}
                  </label>
                  <Input
                    id={`quota-round-${row.id}`}
                    ref={index === rows.length - 1 ? lastRowRef : undefined}
                    className="font-mono tabular-nums"
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.value}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.id === row.id
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-11 px-0 text-muted-foreground"
                    aria-label={`Remove round ${index + 1}`}
                    disabled={rows.length === 1}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
            {rows.length < QUOTA_CALCULATOR_MAX_ROUNDS ? (
              <Button type="button" variant="outline" onClick={addRow}>
                <PlusIcon aria-hidden="true" data-icon="inline-start" />
                Add a round
              </Button>
            ) : (
              <FieldHelp>
                You have added {QUOTA_CALCULATOR_MAX_ROUNDS} rounds. Remove an
                old one to add another.
              </FieldHelp>
            )}
          </fieldset>

          <div className="grid items-start gap-6 sm:grid-cols-2">
            <Field
              id="quota-starting"
              label="Starting quota (optional)"
              help={
                method === "moving_average"
                  ? "You keep this quota until you have enough rounds to count."
                  : "You keep this quota until you have 10 rounds."
              }
            >
              <Input
                id="quota-starting"
                className="font-mono tabular-nums"
                inputMode="decimal"
                autoComplete="off"
                value={startingQuota}
                onChange={(event) => setStartingQuota(event.target.value)}
              />
            </Field>
          </div>

          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <Button type="submit">Calculate your quota</Button>
        </form>
      </Card>

      <section
        className="lg:sticky lg:top-6 [&>p]:mt-0"
        aria-label="Your quota"
        aria-live="polite"
      >
        <QuotaResult method={method} outcome={outcome} />
      </section>
    </div>
  );
}

function QuotaResult({
  method,
  outcome,
}: Readonly<{
  method: QuotaCalculatorMethod;
  outcome: QuotaCalculatorOutcome | null;
}>) {
  if (outcome?.status === "starting_quota_needed") {
    return (
      <FormMessage tone="info" role="status">
        Add your points from at least one round, or type a starting quota, then
        calculate again.
      </FormMessage>
    );
  }

  if (outcome?.status !== "ready") {
    return (
      <EmptyState>
        Type your points and calculate to see your quota here.
      </EmptyState>
    );
  }

  const { countedPoints, latestRound, quota, roundsEntered, roundsNeeded } =
    outcome;

  return (
    <Card className="gap-0 py-0">
      <div className="border-b p-4">
        <p className="m-0 text-sm text-muted-foreground">Your quota</p>
        <p className="mt-2 mb-0 font-mono text-6xl leading-none font-medium tabular-nums">
          {quota}
        </p>
        <p className="mt-3 mb-0 text-sm leading-[1.55]">
          {outcome.usedStartingQuota
            ? `This is your starting quota. You keep it until you have ${roundsNeeded} rounds; you have added ${roundsEntered}.`
            : roundsEntered < roundsNeeded
              ? `The average of the ${roundsEntered === 1 ? "one round" : `${roundsEntered} rounds`} you added. Once you have ${roundsNeeded}, ${method === "moving_average" ? `only your latest ${roundsNeeded} count` : "your ten highest count"}.`
              : method === "moving_average"
                ? `The average of your latest ${roundsNeeded} rounds.`
                : `The average of your ten highest totals from your latest ${Math.min(roundsEntered, 20)} rounds.`}
        </p>
      </div>

      {countedPoints.length > 0 ? (
        <div className="border-b p-4">
          <p className="m-0 text-sm text-muted-foreground">
            {method === "moving_average"
              ? "Rounds that counted, oldest first"
              : "Rounds that counted, highest first"}
          </p>
          <ul className="mt-2 mb-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 font-mono text-sm font-medium tabular-nums">
            {countedPoints.map((points, index) => (
              <li key={index}>{points}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {latestRound ? (
        <p className="m-0 border-b p-4 text-sm leading-[1.55]">
          Score {latestRound.points} again next round and your plus/minus is{" "}
          <strong className="font-mono font-medium tabular-nums">
            {latestRound.plusMinus}
          </strong>
          {latestRound.plusMinus === "0" ? ", level with your quota." : "."}
        </p>
      ) : null}

      <div className="grid gap-3 p-4">
        <p className="m-0 text-sm leading-[1.55] text-muted-foreground">
          Start a group and every member’s quota updates after each round you
          complete.
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-up?from=quota-calculator">
            Keep quotas for your whole group
          </Link>
        </Button>
      </div>
    </Card>
  );
}
