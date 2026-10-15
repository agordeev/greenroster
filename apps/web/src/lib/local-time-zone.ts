import { useSyncExternalStore } from "react";

export function resolveLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

const noSubscription = () => () => {};

// The browser's time zone, read after hydration. The server render has no
// browser to ask, so it gets an empty string.
export function useLocalTimeZone() {
  return useSyncExternalStore(noSubscription, resolveLocalTimeZone, () => "");
}
