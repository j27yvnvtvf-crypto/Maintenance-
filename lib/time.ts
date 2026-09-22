// Database timestamps are UTC. Daily work is grouped by the property's local
// calendar date so evening activity is not counted as the next day.
const DEFAULT_TIME_ZONE = "America/New_York";

export function appTimeZone() {
  return process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE;
}

export function localDate(value: string | Date = new Date(), timeZone = appTimeZone()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
