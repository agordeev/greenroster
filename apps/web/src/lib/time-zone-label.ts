/**
 * Turns a time zone ID such as "America/New_York" into a name a member
 * recognises ("Eastern Time"), falling back to the city ("New York time").
 */
export function timeZoneLabel(timeZone: string | null | undefined): string {
  if (!timeZone) return "";
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const city = (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ");
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return name && !/^(GMT|UTC)/u.test(name) ? name : `${city} time`;
  } catch {
    return `${city} time`;
  }
}
