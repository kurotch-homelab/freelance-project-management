import type { CalendarEvent } from "./absence.ts";
import { assertResponse } from "./errors.ts";
import type { DriveFile, DriveFolder } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePage(body: unknown, status: number, field: "items" | "files") {
  assertResponse(isRecord(body), status, "list");
  const items = body[field];
  assertResponse(Array.isArray(items), status, `${field} must be an array`);
  const nextPageToken = body.nextPageToken;
  assertResponse(
    nextPageToken === undefined || (typeof nextPageToken === "string" && nextPageToken.length > 0),
    status, "nextPageToken",
  );
  return { items: items as unknown[], nextPageToken };
}

function parseBoundary(value: unknown, status: number): CalendarEvent["start"] {
  assertResponse(isRecord(value), status, "event start/end");
  const { date, dateTime, timeZone } = value;
  assertResponse(
    (typeof date === "string" && date.length > 0 && dateTime === undefined) ||
    (typeof dateTime === "string" && dateTime.length > 0 && date === undefined),
    status, "event date/dateTime",
  );
  assertResponse(timeZone === undefined || typeof timeZone === "string", status, "event timeZone");
  return {
    ...(typeof date === "string" ? { date } : {}),
    ...(typeof dateTime === "string" ? { dateTime } : {}),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

export function parseOutOfOffice(value: unknown, status: number): CalendarEvent | null {
  assertResponse(isRecord(value), status, "event");
  assertResponse(
    (value.status === undefined || typeof value.status === "string") &&
    (value.eventType === undefined || typeof value.eventType === "string"),
    status, "event status/eventType",
  );
  // Cancelled events need not have start/end fields.
  if (value.status === "cancelled" || value.eventType !== "outOfOffice") return null;
  const start = parseBoundary(value.start, status);
  const end = parseBoundary(value.end, status);
  assertResponse((start.date === undefined) === (end.date === undefined), status, "event start/end date types");
  return { start, end };
}

export function parseFolder(value: unknown, status: number): DriveFolder {
  assertResponse(isRecord(value), status, "file");
  assertResponse(typeof value.id === "string" && typeof value.name === "string", status, "file id/name");
  return { id: value.id, name: value.name };
}

export function parseFile(value: unknown, status: number): DriveFile {
  const folder = parseFolder(value, status);
  assertResponse(isRecord(value), status, "file");
  const { mimeType, webViewLink } = value;
  assertResponse(mimeType === undefined || typeof mimeType === "string", status, "file mimeType");
  assertResponse(webViewLink === undefined || typeof webViewLink === "string", status, "file webViewLink");
  return {
    ...folder,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(webViewLink === undefined ? {} : { webViewLink }),
  };
}
