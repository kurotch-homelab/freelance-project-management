import { invoiceDates } from "@fpm/domain";
import { formatDate, parseDate } from "../../domain/src/date.ts";

export function dateInTimeZone(now: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

export function addDays(date: string, days: number): string {
  return formatDate(parseDate(date, "date") + days);
}

export function monthPeriod(month: string) {
  const { invoiceDate } = invoiceDates(month, {
    closingDay: "end", paymentMonthOffset: 0, paymentDay: "end",
  });
  return { from: `${month}-01`, to: invoiceDate };
}

/** 今月を含め、forecastMonths か月先までの月と期間を返す。 */
export function forecastPeriods(asOf: string, forecastMonths: number) {
  if (!Number.isSafeInteger(forecastMonths) || forecastMonths < 0) {
    throw new RangeError("forecastMonths must be a non-negative safe integer");
  }
  const periods = [];
  let month = asOf.slice(0, 7);
  for (let offset = 0; offset <= forecastMonths; offset += 1) {
    const period = monthPeriod(month);
    periods.push({ month, ...period });
    if (offset < forecastMonths) month = addDays(period.to, 1).slice(0, 7);
  }
  return periods;
}
