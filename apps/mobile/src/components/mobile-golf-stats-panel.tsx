import { useEffect, useState } from "react";
import { View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import {
  mobileHoleScorecardApi,
  type MobilePersonalGolfStats,
} from "@/lib/rounds/mobile-hole-scorecard-api";

export function MobileGolfStatsPanel() {
  const [stats, setStats] = useState<MobilePersonalGolfStats | null>(null);
  const [message, setMessage] = useState("Loading your golf stats…");
  useEffect(() => {
    let active = true;
    void mobileHoleScorecardApi.stats().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setStats(result.data);
      setMessage("");
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="subtitle">Your golf stats</ThemedText>
      {message ? (
        <ThemedText themeColor="textSecondary">{message}</ThemedText>
      ) : null}
      {stats ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText>Rounds tracked: {stats.roundsTracked}</ThemedText>
          <ThemedText>
            Strokes entered: {stats.holesWithStrokes} holes ·{" "}
            {stats.strokesTotal} total
            {stats.averageStrokes === null
              ? ""
              : ` · ${stats.averageStrokes.toFixed(2)} average`}
          </ThemedText>
          <ThemedText>
            Putts entered: {stats.holesWithPutts} holes · {stats.puttsTotal}{" "}
            total
            {stats.averagePutts === null
              ? ""
              : ` · ${stats.averagePutts.toFixed(2)} average`}
          </ThemedText>
          <ThemedText>
            Fairways: {stats.fairwaysHit}/{stats.fairwaysAttempted} · Greens:{" "}
            {stats.greensHit}/{stats.greensAttempted} · Sand saves:{" "}
            {stats.sandSaves}/{stats.sandAttempted}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
