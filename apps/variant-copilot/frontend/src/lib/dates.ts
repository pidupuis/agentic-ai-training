/**
 * Dates in ISO 8601 order (year-month-day, 24 h clock), unambiguous in every country:
 * 2026-11-03 is never read as 11 March or 3 November.
 *
 * The backend stores UTC ("2026-11-25T13:40:00.123456Z"); we show the browser's local
 * time, and the exact UTC timestamp is available as a tooltip (title attribute).
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-25T13:40:00Z" -> "2026-11-25 14:40" (local time, here UTC+1). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` + // getMonth is 0-based
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The exact UTC timestamp, for a tooltip: "2026-11-25T13:40:00.123Z". */
export function utcTooltip(iso: string): string {
  return new Date(iso).toISOString();
}
