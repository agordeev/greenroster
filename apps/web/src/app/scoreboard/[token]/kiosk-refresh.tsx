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
        ? "You see live scores refresh every 30 seconds."
        : "You see live scores refresh now."}
    </p>
  ) : null;
}
