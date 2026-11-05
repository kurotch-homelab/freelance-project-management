const MILLISECONDS_PER_DAY = 86_400_000;

/** YYYY-MM-DD を検証し、UTC の 1970-01-01 からの日数に変換する。 */
export function parseDate(value: string, name: string): number {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${name} must be a valid date in YYYY-MM-DD format`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC が 0〜99 年を 1900〜1999 年と解釈するのを補正する。
  if (year < 100) {
    date.setUTCFullYear(year, month - 1, day);
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`${name} must be a valid date in YYYY-MM-DD format`);
  }
  return date.getTime() / MILLISECONDS_PER_DAY;
}

/** UTC の 1970-01-01 からの日数を YYYY-MM-DD に戻す。 */
export function formatDate(day: number): string {
  return new Date(day * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** UTC の日数に対応する曜日を返す(0 = 日曜)。 */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}
