const DAY_MS = 86_400_000;

interface CalendarEventBoundary {
  readonly dateTime?: string;
  readonly date?: string;
  readonly timeZone?: string;
}

/** The start/end fields of a Google Calendar API event. */
export interface CalendarEvent {
  readonly start: CalendarEventBoundary;
  readonly end: CalendarEventBoundary;
}

interface Interval {
  start: number;
  end: number;
}

function parseDate(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Dates must be valid YYYY-MM-DD calendar dates");
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Dates must be valid YYYY-MM-DD calendar dates");
  }
  return timestamp;
}

function parseDateTime(value: string): number {
  const match = typeof value === "string" &&
    /^(\d{4}-\d{2}-\d{2})[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) throw new RangeError("dateTime must include a valid time and an explicit UTC offset");
  parseDate(match[1]!); // Date.parse alone can normalize impossible dates such as February 30.
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError("Invalid dateTime");
  return timestamp;
}

function createCalendar(timeZone: string) {
  if (typeof timeZone !== "string" || timeZone.length === 0) throw new RangeError("Invalid timeZone");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Encode the local calendar fields as UTC solely for calendar arithmetic.
  function localTimestamp(instant: number): number {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
    const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
    const date = new Date(0);
    date.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
    date.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
    return date.getTime();
  }

  const midnights = new Map<number, number>();
  function midnight(day: number): number {
    const cached = midnights.get(day);
    if (cached !== undefined) return cached;

    // Try offsets on both sides of the date. A repeated midnight starts at its
    // earliest occurrence; a skipped midnight starts at the clock transition.
    const candidates = [-DAY_MS, 0, DAY_MS].map((delta) => {
      const sample = day + delta;
      return day - (localTimestamp(sample) - sample);
    });
    const exact = candidates.filter((instant) => localTimestamp(instant) === day);
    let result: number;
    if (exact.length > 0) {
      result = Math.min(...exact);
    } else {
      let low = Math.min(...candidates);
      let high = Math.max(...candidates);
      // Search in whole seconds, matching Intl's fields and time-zone offsets.
      while (high - low > 1_000) {
        const middle = low + Math.floor((high - low) / 2_000) * 1_000;
        if (localTimestamp(middle) < day) low = middle;
        else high = middle;
      }
      result = high;
    }
    midnights.set(day, result);
    return result;
  }

  return {
    midnight,
    dayOf(instant: number): number {
      return Math.floor(localTimestamp(instant) / DAY_MS) * DAY_MS;
    },
  };
}

/** Count the union of event intervals, grouped by local date in the inclusive range. */
export function absenceSecondsByDay(
  events: readonly CalendarEvent[],
  options: { readonly timeZone: string; readonly from: string; readonly to: string },
): Record<string, number> {
  if (!Array.isArray(events) || !options) throw new RangeError("Events and date range are required");
  const calendar = createCalendar(options.timeZone);
  const firstDay = parseDate(options.from);
  const lastDay = parseDate(options.to);
  if (firstDay > lastDay) throw new RangeError("from must be on or before to");
  const rangeStart = calendar.midnight(firstDay);
  const rangeEnd = calendar.midnight(lastDay + DAY_MS);

  const intervals: Interval[] = [];
  for (const event of events) {
    const start = event?.start;
    const end = event?.end;
    if (!start || !end) throw new RangeError("An event must have a start and an end");
    let interval: Interval;
    if (start.dateTime !== undefined && end.dateTime !== undefined && start.date === undefined && end.date === undefined) {
      // The explicit offsets define instants; event-level timeZone fields do not override them.
      interval = { start: parseDateTime(start.dateTime), end: parseDateTime(end.dateTime) };
    } else if (start.date !== undefined && end.date !== undefined && start.dateTime === undefined && end.dateTime === undefined) {
      const startDay = parseDate(start.date);
      const endDay = parseDate(end.date);
      if (endDay < startDay) throw new RangeError("Event end must be on or after start");
      interval = { start: calendar.midnight(startDay), end: calendar.midnight(endDay) };
    } else {
      throw new RangeError("Event start and end must both use either dateTime or date");
    }
    if (interval.end < interval.start) throw new RangeError("Event end must be on or after start");
    interval.start = Math.max(interval.start, rangeStart);
    interval.end = Math.min(interval.end, rangeEnd);
    if (interval.start < interval.end) intervals.push(interval);
  }

  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }

  const secondsByDay: Record<string, number> = {};
  for (const interval of merged) {
    for (let day = Math.max(firstDay, calendar.dayOf(interval.start)); day <= lastDay; day += DAY_MS) {
      const dayEnd = calendar.midnight(day + DAY_MS);
      const duration = Math.min(interval.end, dayEnd) - Math.max(interval.start, calendar.midnight(day));
      if (duration > 0) {
        const key = new Date(day).toISOString().slice(0, 10);
        secondsByDay[key] = (secondsByDay[key] ?? 0) + duration / 1_000;
      }
      if (dayEnd >= interval.end) break;
    }
  }
  return secondsByDay;
}
