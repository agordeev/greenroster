"use client";

import { useEffect, useState } from "react";

export function KioskRefresh({ enabled }: Readonly<{ enabled: boolean }>) {
  const [status, setStatus] = useState<"current" | "refreshing">("current");
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      setStatus("refreshing");
      window.location.reload();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return enabled ? (
    <p className="scoreboard-kiosk-status" role="status">
      {status === "current"
        ? "Scores refresh every 30 seconds."
        : "Scores are refreshing now."}
    </p>
  ) : null;
}
