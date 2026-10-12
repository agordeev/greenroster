"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";

import { setRoundParticipantHoleScoreAction } from "@/app/actions/rounds";
import { SectionHeading } from "@/components/blocks";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  roundHoleScoreInputSchema,
  type RoundHoleScoreRow,
} from "@/domain/round-hole-scorecard";

type HoleDraft = {
  strokes: string;
  putts: string;
  fairway_hit: "" | "true" | "false";
  green_in_regulation: "" | "true" | "false";
  sand_save: "" | "true" | "false";
  hole_comment: string;
};

function displayName(row: RoundHoleScoreRow) {
  return (
    [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed player"
  );
}

function draftFromRow(row: RoundHoleScoreRow): HoleDraft {
  return {
    strokes: row.strokes === null ? "" : String(row.strokes),
    putts: row.putts === null ? "" : String(row.putts),
    fairway_hit:
      row.fairwayHit === null
        ? ""
        : (String(row.fairwayHit) as HoleDraft["fairway_hit"]),
    green_in_regulation:
      row.greenInRegulation === null
        ? ""
        : (String(row.greenInRegulation) as HoleDraft["green_in_regulation"]),
    sand_save:
      row.sandSave === null
        ? ""
        : (String(row.sandSave) as HoleDraft["sand_save"]),
    hole_comment: row.holeComment ?? "",
  };
}

function valueFromToggle(value: HoleDraft["fairway_hit"]): boolean | null {
  return value === "" ? null : value === "true";
}

export function RoundHoleScorecardPanel({
  rows,
  state,
}: Readonly<{
  rows: readonly RoundHoleScoreRow[];
  state: "published" | "live" | "completed";
}>) {
  const [message, setMessage] = useState<string | null>(null);
  const byParticipant = useMemo(() => {
    const grouped = new Map<string, RoundHoleScoreRow[]>();
    for (const row of rows) {
      const current = grouped.get(row.participantId) ?? [];
      current.push(row);
      grouped.set(row.participantId, current);
    }
    return [...grouped.values()].sort((a, b) =>
      displayName(a[0]).localeCompare(displayName(b[0])),
    );
  }, [rows]);

  return (
    <section
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0!"
      aria-labelledby="round-hole-scorecard-title"
    >
      <SectionHeading
        kicker="Scoring"
        title="Hole scorecard"
        titleId="round-hole-scorecard-title"
        meta={
          rows.length === 0
            ? "No holes yet"
            : `${byParticipant.length} player${byParticipant.length === 1 ? "" : "s"}`
        }
      />
      <p>
        Enter strokes, putts, fairways, greens, sand saves, and an optional note
        for each hole.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {byParticipant.length === 0 ? (
        <p className="mx-0 mt-6 mb-0 p-4 border border-border/50 text-muted-foreground leading-[1.55]">
          Hole details appear once this round has players.
        </p>
      ) : (
        <div className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
          {byParticipant.map((participantRows) => (
            <ParticipantHoleScorecard
              key={participantRows[0].participantId}
              rows={participantRows}
              state={state}
              onMessage={setMessage}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ParticipantHoleScorecard({
  rows,
  state,
  onMessage,
}: Readonly<{
  rows: readonly RoundHoleScoreRow[];
  state: "published" | "live" | "completed";
  onMessage: (message: string) => void;
}>) {
  const [values, setValues] = useState(
    () => new Map(rows.map((row) => [row.holeNumber, draftFromRow(row)])),
  );
  const [confirmed, setConfirmed] = useState(
    () => new Map(rows.map((row) => [row.holeNumber, row])),
  );
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const readOnly = state !== "live";

  function update(hole: number, field: keyof HoleDraft, value: string) {
    setValues((current) =>
      new Map(current).set(hole, { ...current.get(hole)!, [field]: value }),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>, row: RoundHoleScoreRow) {
    event.preventDefault();
    if (pending || readOnly || !row.canEdit) return;
    const draft = values.get(row.holeNumber)!;
    const current = confirmed.get(row.holeNumber)!;
    const changedFields: Record<string, unknown> = {};
    const strokes = draft.strokes.trim() === "" ? null : Number(draft.strokes);
    const putts = draft.putts.trim() === "" ? null : Number(draft.putts);
    if (strokes !== current.strokes) changedFields.strokes = strokes;
    if (putts !== current.putts) changedFields.putts = putts;
    const fairway = valueFromToggle(draft.fairway_hit);
    const gir = valueFromToggle(draft.green_in_regulation);
    const sand = valueFromToggle(draft.sand_save);
    if (fairway !== current.fairwayHit) changedFields.fairway_hit = fairway;
    if (gir !== current.greenInRegulation)
      changedFields.green_in_regulation = gir;
    if (sand !== current.sandSave) changedFields.sand_save = sand;
    if (draft.hole_comment.trim() !== (current.holeComment ?? ""))
      changedFields.hole_comment = draft.hole_comment;
    const parsed = roundHoleScoreInputSchema.safeParse({
      participantId: row.participantId,
      holeNumber: row.holeNumber,
      changedFields,
      expectedVersion: current.version,
      deviceOperationId: crypto.randomUUID(),
      reason: reason.trim() || null,
      clientChangedAt: new Date().toISOString(),
      operationId: crypto.randomUUID(),
    });
    if (!parsed.success) {
      onMessage("Check the hole details and try again.");
      return;
    }
    startTransition(async () => {
      const result = await setRoundParticipantHoleScoreAction(parsed.data);
      if (!result.ok) {
        onMessage(result.error.message);
        return;
      }
      const next = {
        ...current,
        version: result.data.version,
        strokes: result.data.strokes,
        putts: result.data.putts,
        fairwayHit: result.data.fairwayHit,
        greenInRegulation: result.data.greenInRegulation,
        sandSave: result.data.sandSave,
        holeComment: result.data.holeComment,
        updatedAt: result.data.updatedAt,
      } satisfies RoundHoleScoreRow;
      setConfirmed((currentRows) =>
        new Map(currentRows).set(row.holeNumber, next),
      );
      setValues((currentValues) =>
        new Map(currentValues).set(row.holeNumber, draftFromRow(next)),
      );
      setReason("");
      onMessage("Your hole details are saved.");
    });
  }

  return (
    <article className="p-4 gap-4 border border-border/50 flex items-center justify-between bg-muted max-[720px]:items-start max-[720px]:flex-col [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!">
      <div className="gap-4 flex items-end justify-between max-[720px]:items-start max-[720px]:flex-col [&>p]:mx-0 [&>p]:mb-0 [&>p]:text-muted-foreground [&>p]:whitespace-nowrap [&>p]:mt-0! [&>p]:text-[0.75rem]! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0">
        <h3>
          {displayName(rows[0])}
          {rows[0].participantKind === "guest" ? " · Guest" : ""}
        </h3>
        <p>{readOnly ? "View only" : "You can edit"}</p>
      </div>
      {!readOnly ? (
        <label
          className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
          data-slot="field"
          htmlFor={`hole-reason-${rows[0].participantId}`}
        >
          <span>Reason for the change</span>
          <Input
            id={`hole-reason-${rows[0].participantId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </label>
      ) : null}
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            Hole details for {displayName(rows[0])}
          </caption>
          <thead>
            <tr>
              <th>Hole</th>
              <th>Strokes</th>
              <th>Putts</th>
              <th>Fairway</th>
              <th>Green</th>
              <th>Sand save</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = values.get(row.holeNumber)!;
              return (
                <tr key={row.holeNumber}>
                  <td>{row.holeNumber}</td>
                  <td>
                    <Input
                      aria-label={`Hole ${row.holeNumber} strokes`}
                      inputMode="numeric"
                      min={0}
                      max={30}
                      step={1}
                      value={draft.strokes}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(row.holeNumber, "strokes", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Hole ${row.holeNumber} putts`}
                      inputMode="numeric"
                      min={0}
                      max={20}
                      step={1}
                      value={draft.putts}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(row.holeNumber, "putts", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <NativeSelect
                      aria-label={`Hole ${row.holeNumber} fairway`}
                      value={draft.fairway_hit}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(
                          row.holeNumber,
                          "fairway_hit",
                          event.target.value,
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </NativeSelect>
                  </td>
                  <td>
                    <NativeSelect
                      aria-label={`Hole ${row.holeNumber} green`}
                      value={draft.green_in_regulation}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(
                          row.holeNumber,
                          "green_in_regulation",
                          event.target.value,
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </NativeSelect>
                  </td>
                  <td>
                    <NativeSelect
                      aria-label={`Hole ${row.holeNumber} sand save`}
                      value={draft.sand_save}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(row.holeNumber, "sand_save", event.target.value)
                      }
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </NativeSelect>
                  </td>
                  <td>
                    <Input
                      aria-label={`Hole ${row.holeNumber} note`}
                      value={draft.hole_comment}
                      maxLength={500}
                      disabled={!row.canEdit || readOnly || pending}
                      onChange={(event) =>
                        update(
                          row.holeNumber,
                          "hole_comment",
                          event.target.value,
                        )
                      }
                    />
                  </td>
                  <td>
                    <form onSubmit={(event) => submit(event, row)}>
                      <button
                        type="submit"
                        disabled={!row.canEdit || readOnly || pending}
                      >
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
