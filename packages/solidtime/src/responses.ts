import { assertResponse } from "./errors.ts";
import type { Client, Project, TimeEntry } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function dataOf(body: unknown, status: number): unknown {
  assertResponse(isRecord(body) && "data" in body, status, "data");
  return body.data;
}

export function arrayData(body: unknown, status: number): unknown[] {
  const data = dataOf(body, status);
  assertResponse(Array.isArray(data), status, "data must be an array");
  return data;
}

export function parseClient(value: unknown, status: number): Client {
  assertResponse(isRecord(value), status, "client");
  assertResponse(
    typeof value.id === "string" && typeof value.name === "string" && typeof value.is_archived === "boolean",
    status, "client fields",
  );
  return { id: value.id, name: value.name, isArchived: value.is_archived };
}

export function parseProject(value: unknown, status: number): Project {
  assertResponse(isRecord(value), status, "project");
  assertResponse(
    typeof value.id === "string" && typeof value.name === "string" && typeof value.color === "string" &&
    isNullableString(value.client_id) && typeof value.is_billable === "boolean" &&
    typeof value.is_archived === "boolean" && typeof value.is_public === "boolean" &&
    (value.billable_rate === null || isNonnegativeInteger(value.billable_rate)) &&
    (value.estimated_time === null || isNonnegativeInteger(value.estimated_time)),
    status, "project fields",
  );
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    clientId: value.client_id,
    hourlyRate: value.billable_rate === null ? null : value.billable_rate / 100,
    isBillable: value.is_billable,
    isArchived: value.is_archived,
    isPublic: value.is_public,
    estimatedTime: value.estimated_time,
  };
}

export function parseTimeEntry(
  value: unknown,
  status: number,
  date: (timestamp: string) => string,
): TimeEntry | null {
  assertResponse(isRecord(value), status, "time entry");
  assertResponse(
    typeof value.id === "string" && typeof value.user_id === "string" && isNullableString(value.project_id) &&
    isTimestamp(value.start) && (value.end === null || isTimestamp(value.end)) &&
    isNullableString(value.description) && typeof value.billable === "boolean" &&
    (value.duration === null || isNonnegativeInteger(value.duration)),
    status, "time entry fields",
  );
  if (value.end === null) return null;
  assertResponse(
    isNonnegativeInteger(value.duration) && Date.parse(value.end) >= Date.parse(value.start),
    status, "completed time entry duration",
  );
  return {
    id: value.id,
    userId: value.user_id,
    projectId: value.project_id,
    start: value.start,
    end: value.end,
    date: date(value.start),
    // Use solidtime's duration without recomputing or rounding it.
    seconds: value.duration,
    description: value.description,
    billable: value.billable,
  };
}
