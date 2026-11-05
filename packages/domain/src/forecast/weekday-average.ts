import { parseDate, weekday } from "../date.ts";

export interface DailyWork {
  readonly date: string;
  readonly seconds: number;
}

/**
 * 今日を含まない直近 weeks 週の曜日別平均を、日曜から土曜の 7 要素で返す。
 * 今日より前の記録がなければ null。平均の端数は丸めない。
 */
export function weekdayAverages(
  work: readonly DailyWork[],
  { asOf, weeks }: { readonly asOf: string; readonly weeks: number },
): readonly number[] | null {
  const end = parseDate(asOf, "asOf");
  if (!Number.isSafeInteger(weeks) || weeks <= 0 || !Number.isSafeInteger(7 * weeks)) {
    throw new RangeError("weeks must be a positive safe integer with a safe day count");
  }

  const windowStart = end - 7 * weeks;
  const totals: number[] = Array<number>(7).fill(0);
  let firstDay: number | null = null;
  for (const { date, seconds } of work) {
    const day = parseDate(date, "work.date");
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new RangeError("work.seconds must be a non-negative safe integer");
    }
    if (day >= end) {
      continue;
    }
    firstDay = firstDay === null ? day : Math.min(firstDay, day);
    if (day >= windowStart) {
      const index = weekday(day);
      const total = (totals[index] ?? 0) + seconds;
      if (!Number.isSafeInteger(total)) {
        throw new RangeError("weekday total must be a safe integer");
      }
      totals[index] = total;
    }
  }
  if (firstDay === null) {
    return null;
  }

  const start = Math.max(windowStart, firstDay);
  const days = end - start;
  const fullWeeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  const firstWeekday = weekday(start);
  return totals.map((total, index) => {
    // 記録のない日も分母に含め、最初の記録より前の日は含めない。
    const offset = (index - firstWeekday + 7) % 7;
    const count = fullWeeks + (offset < remainingDays ? 1 : 0);
    return count === 0 ? 0 : total / count;
  });
}
