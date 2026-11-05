import type { CalendarEvent } from "./absence.ts";
import { createGoogleRequest, listGooglePages } from "./request.ts";
import { parseOutOfOffice } from "./responses.ts";
import type { CalendarClient, CalendarClientOptions } from "./types.ts";

export function createCalendarClient(options: CalendarClientOptions): CalendarClient {
  const request = createGoogleRequest(options);
  const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events`;

  return {
    async listOutOfOffice({ timeMin, timeMax }) {
      const url = new URL(eventsUrl);
      url.search = new URLSearchParams({
        timeMin, timeMax, eventTypes: "outOfOffice", singleEvents: "true", maxResults: "2500",
      }).toString();
      const events: CalendarEvent[] = [];
      for await (const page of listGooglePages(request, url, "items", parseOutOfOffice)) {
        for (const event of page) if (event !== null) events.push(event);
      }
      return events;
    },
  };
}
