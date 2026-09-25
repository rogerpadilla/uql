/**
 * `YYYY-MM-DD HH:mm:ss.SSS` in UTC, then `zone`: how a date is written, whichever machine writes it. Not
 * `toISOString` as it is, whose `T` and `Z` MySQL rejects outright ("Invalid default value").
 */
export function utcTimestamp(date: Date, zone = ''): string {
  return date.toISOString().replace('T', ' ').replace('Z', zone);
}

/** A time of day that names no zone, which `Date` would read in the process's own. */
const ZONELESS_TIME = /T[\d:.]+$/;

/**
 * A timestamp's text as the `Date` it names, the one rule every driver and hydration read dates by: UTC
 * where it names no zone, its own offset where it does, a bare day at UTC midnight, and the fraction cut
 * to the milliseconds a `Date` holds. Text that is none of these, such as `infinity`, stays text.
 */
export function decodeDate(text: string): Date | string {
  const iso = text.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(ZONELESS_TIME.test(iso) ? `${iso}Z` : iso);
  return Number.isNaN(date.getTime()) ? text : date;
}
