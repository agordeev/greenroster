import { randomUUID } from "expo-crypto";

export function createMobileOperationId() {
  return randomUUID();
}
