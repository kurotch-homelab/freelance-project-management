const DAY_MS = 86_400_000;

function parseDate(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Dates must be valid YYYY-MM-DD calendar dates");
  }
  return timestamp;
}

export function createTimeZone(timeZone: string) {
  // Explicit calendar, digits and hour cycle keep parsing independent of locale and host TZ.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function localDateTime(timestamp: number): string {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    return `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }

  function midnight(localTimestamp: number): string {
    let instant = localTimestamp;
    // Re-evaluate the offset at the target instant: DST may differ from the initial guess.
    for (let attempt = 0; attempt < 4; attempt++) {
      const correction = localTimestamp - Date.parse(`${localDateTime(instant)}Z`);
      if (correction === 0) return new Date(instant).toISOString().replace(".000Z", "Z");
      instant += correction;
    }
    throw new RangeError("The calendar date has no resolvable midnight in the selected timeZone");
  }

  return {
    date(timestamp: string): string {
      return localDateTime(Date.parse(timestamp)).slice(0, 10);
    },
    range(from: string, to: string): { start: string; end: string } {
      const firstDay = parseDate(from);
      const lastDay = parseDate(to);
      if (firstDay > lastDay) throw new RangeError("from must be on or before to");
      // Add a calendar day before converting, rather than 24 hours after conversion.
      return { start: midnight(firstDay), end: midnight(lastDay + DAY_MS) };
    },
  };
}
