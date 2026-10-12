import { useEffect, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import {
  mobileHoleScorecardApi,
  type MobileHoleScoreRow,
} from "@/lib/rounds/mobile-hole-scorecard-api";

type Draft = {
  strokes: string;
  putts: string;
  fairwayHit: "" | "true" | "false";
  greenInRegulation: "" | "true" | "false";
  sandSave: "" | "true" | "false";
  holeComment: string;
};

function draftFromRow(row: MobileHoleScoreRow): Draft {
  return {
    strokes: row.strokes === null ? "" : String(row.strokes),
    putts: row.putts === null ? "" : String(row.putts),
    fairwayHit:
      row.fairwayHit === null
        ? ""
        : (String(row.fairwayHit) as Draft["fairwayHit"]),
    greenInRegulation:
      row.greenInRegulation === null
        ? ""
        : (String(row.greenInRegulation) as Draft["greenInRegulation"]),
    sandSave:
      row.sandSave === null ? "" : (String(row.sandSave) as Draft["sandSave"]),
    holeComment: row.holeComment ?? "",
  };
}

function boolValue(value: "" | "true" | "false") {
  return value === "" ? null : value === "true";
}

export function MobileHoleScorecard({
  roundId,
  participantId,
}: Readonly<{ roundId: string; participantId: string | null }>) {
  const theme = useTheme();
  const [rows, setRows] = useState<readonly MobileHoleScoreRow[]>([]);
  const [drafts, setDrafts] = useState<Map<number, Draft>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [savingHole, setSavingHole] = useState<number | null>(null);

  const selectedRows = useMemo(
    () => rows.filter((row) => row.participantId === participantId),
    [participantId, rows],
  );

  useEffect(() => {
    let active = true;
    void mobileHoleScorecardApi.read(roundId).then((result) => {
      if (!active) return;
      setMessage(null);
      if (!result.ok) {
        setStatus("error");
        setMessage(result.message);
        return;
      }
      setRows(result.data);
      setDrafts(
        new Map(result.data.map((row) => [row.holeNumber, draftFromRow(row)])),
      );
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [roundId]);

  function update(hole: number, field: keyof Draft, value: string) {
    setDrafts((current) =>
      new Map(current).set(hole, { ...current.get(hole)!, [field]: value }),
    );
  }

  async function save(row: MobileHoleScoreRow) {
    const draft = drafts.get(row.holeNumber);
    if (!draft || !row.canEdit || savingHole !== null) return;
    const changedFields: Record<string, unknown> = {};
    const strokes = draft.strokes.trim() === "" ? null : Number(draft.strokes);
    const putts = draft.putts.trim() === "" ? null : Number(draft.putts);
    if (strokes !== row.strokes) changedFields.strokes = strokes;
    if (putts !== row.putts) changedFields.putts = putts;
    const fairwayHit = boolValue(draft.fairwayHit);
    const greenInRegulation = boolValue(draft.greenInRegulation);
    const sandSave = boolValue(draft.sandSave);
    if (fairwayHit !== row.fairwayHit) changedFields.fairway_hit = fairwayHit;
    if (greenInRegulation !== row.greenInRegulation)
      changedFields.green_in_regulation = greenInRegulation;
    if (sandSave !== row.sandSave) changedFields.sand_save = sandSave;
    if (draft.holeComment.trim() !== (row.holeComment ?? ""))
      changedFields.hole_comment = draft.holeComment;
    if (Object.keys(changedFields).length === 0) return;
    setSavingHole(row.holeNumber);
    const result = await mobileHoleScorecardApi.set({
      participantId: row.participantId,
      holeNumber: row.holeNumber,
      changedFields,
      expectedVersion: row.version,
    });
    setSavingHole(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const next = result.data;
    const updated = { ...row, ...next } satisfies MobileHoleScoreRow;
    setRows((current) =>
      current.map((currentRow) =>
        currentRow.holeNumber === next.holeNumber ? updated : currentRow,
      ),
    );
    setDrafts((current) =>
      new Map(current).set(next.holeNumber, draftFromRow(updated)),
    );
    setMessage("Your hole details are saved.");
  }

  if (participantId === null) return null;

  return (
    <View style={{ gap: Spacing.three }}>
      <View>
        <ThemedLabel text="Hole details" />
        <ThemedLabel
          muted
          text="Enter your strokes, putts, and optional stats. These details do not change points."
        />
      </View>
      {status === "loading" ? (
        <ThemedLabel muted text="Loading your hole details…" />
      ) : null}
      {status === "error" ? (
        <ThemedLabel
          muted
          text={message ?? "We couldn't load your hole details."}
        />
      ) : null}
      {status === "ready" && selectedRows.length === 0 ? (
        <ThemedLabel
          muted
          text="Hole details aren't available for this round."
        />
      ) : null}
      {selectedRows.map((row) => {
        const draft = drafts.get(row.holeNumber)!;
        return (
          <View
            key={row.holeNumber}
            style={{
              gap: Spacing.two,
              borderColor: theme.separator,
              borderWidth: 1,
              borderRadius: 12,
              padding: Spacing.three,
            }}
          >
            <ThemedLabel text={`Hole ${row.holeNumber}`} />
            <View style={{ flexDirection: "row", gap: Spacing.two }}>
              <Input
                theme={theme}
                label="Strokes"
                value={draft.strokes}
                onChangeText={(value) =>
                  update(row.holeNumber, "strokes", value)
                }
                keyboardType="number-pad"
                disabled={!row.canEdit || savingHole !== null}
              />
              <Input
                theme={theme}
                label="Putts"
                value={draft.putts}
                onChangeText={(value) => update(row.holeNumber, "putts", value)}
                keyboardType="number-pad"
                disabled={!row.canEdit || savingHole !== null}
              />
            </View>
            <Toggle
              theme={theme}
              label="Fairway hit"
              value={draft.fairwayHit}
              onChange={(value) => update(row.holeNumber, "fairwayHit", value)}
              disabled={!row.canEdit || savingHole !== null}
            />
            <Toggle
              theme={theme}
              label="Green in regulation"
              value={draft.greenInRegulation}
              onChange={(value) =>
                update(row.holeNumber, "greenInRegulation", value)
              }
              disabled={!row.canEdit || savingHole !== null}
            />
            <Toggle
              theme={theme}
              label="Sand save"
              value={draft.sandSave}
              onChange={(value) => update(row.holeNumber, "sandSave", value)}
              disabled={!row.canEdit || savingHole !== null}
            />
            <Input
              theme={theme}
              label="Hole note"
              value={draft.holeComment}
              onChangeText={(value) =>
                update(row.holeNumber, "holeComment", value)
              }
              disabled={!row.canEdit || savingHole !== null}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save hole ${row.holeNumber}`}
              onPress={() => void save(row)}
              disabled={!row.canEdit || savingHole !== null}
              style={{
                borderColor: theme.separator,
                borderWidth: 1,
                borderRadius: 8,
                padding: Spacing.two,
              }}
            >
              <ThemedLabel
                text={
                  savingHole === row.holeNumber
                    ? "Saving…"
                    : row.canEdit
                      ? "Save hole"
                      : "Read only"
                }
              />
            </Pressable>
          </View>
        );
      })}
      {message && status === "ready" ? (
        <ThemedLabel muted text={message} />
      ) : null}
    </View>
  );
}

function ThemedLabel({
  text,
  muted = false,
}: Readonly<{ text: string; muted?: boolean }>) {
  return (
    <ThemedText
      type={muted ? "small" : "smallBold"}
      themeColor={muted ? "textSecondary" : undefined}
    >
      {text}
    </ThemedText>
  );
}

function Input({
  theme,
  label,
  ...props
}: Readonly<{
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "number-pad";
  disabled: boolean;
}>) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <ThemedLabel text={label} />
      <TextInput
        {...props}
        placeholder={label}
        placeholderTextColor={theme.textSecondary}
        style={{
          borderColor: theme.separator,
          borderWidth: 1,
          borderRadius: 8,
          color: theme.text,
          padding: Spacing.two,
        }}
      />
    </View>
  );
}

function Toggle({
  theme,
  label,
  value,
  onChange,
  disabled,
}: Readonly<{
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: Draft["fairwayHit"];
  onChange: (value: Draft["fairwayHit"]) => void;
  disabled: boolean;
}>) {
  return (
    <View style={{ gap: 4 }}>
      <ThemedLabel text={label} />
      <View style={{ flexDirection: "row", gap: Spacing.two }}>
        {(["", "true", "false"] as const).map((option) => (
          <Pressable
            key={option || "unset"}
            onPress={() => onChange(option)}
            disabled={disabled}
            style={{
              borderColor: theme.separator,
              borderWidth: 1,
              borderRadius: 8,
              padding: Spacing.two,
              opacity: value === option ? 1 : 0.6,
            }}
          >
            <ThemedLabel
              text={
                option === "" ? "Not entered" : option === "true" ? "Yes" : "No"
              }
              muted={value !== option}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
