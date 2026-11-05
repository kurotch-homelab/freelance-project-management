import type { ClientRecord, HoursRangeOverrideRecord, ProjectRecord } from "@fpm/db";
import type { Contract, HoursRange } from "@fpm/domain";

function invalid(field: string): never {
  throw new RangeError(`Invalid ${field}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : string(value, field);
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function integer(value: unknown, min: number, max: number, field: string): number {
  const result = number(value, field);
  if (!Number.isInteger(result) || result < min || result > max) invalid(field);
  return result;
}

function oneOf<const T extends string>(value: unknown, choices: readonly T[], field: string): T {
  for (const choice of choices) {
    if (value === choice) return choice;
  }
  return invalid(field);
}

function record<T>(value: unknown, field: string, parse: (value: unknown, field: string) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(object(value, field))
    .map(([key, entry]) => [key, parse(entry, `${field}.${key}`)]));
}

function hoursRange(value: unknown, field: string): HoursRange {
  const range = object(value, field);
  return {
    ...(range.minHours === undefined ? {} : { minHours: number(range.minHours, `${field}.minHours`) }),
    ...(range.maxHours === undefined ? {} : { maxHours: number(range.maxHours, `${field}.maxHours`) }),
  };
}

export function parseMonth(value: unknown): string {
  const month = string(value, "month");
  if (month.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError("month must be a valid month in YYYY-MM format");
  }
  return month;
}

export function parseClient(value: unknown): ClientRecord {
  const client = object(value, "client");
  const terms = object(client.paymentTerms, "paymentTerms");
  return {
    id: string(client.id, "id"),
    name: string(client.name, "name"),
    paymentTerms: {
      closingDay: terms.closingDay === "end" ? "end" : integer(terms.closingDay, 1, 31, "closingDay"),
      paymentMonthOffset: integer(terms.paymentMonthOffset, 0, 12, "paymentMonthOffset"),
      paymentDay: terms.paymentDay === "end" ? "end" : integer(terms.paymentDay, 1, 31, "paymentDay"),
    },
    subjectTemplate: string(client.subjectTemplate, "subjectTemplate"),
    lineGrouping: oneOf(client.lineGrouping, ["project", "contract"], "lineGrouping"),
    solidtimeClientId: nullableString(client.solidtimeClientId, "solidtimeClientId"),
    driveFolderId: nullableString(client.driveFolderId, "driveFolderId"),
  };
}

export function parseProject(value: unknown): ProjectRecord {
  const project = object(value, "project");
  return {
    id: string(project.id, "id"),
    clientId: string(project.clientId, "clientId"),
    name: string(project.name, "name"),
    status: oneOf(project.status, ["proposed", "won", "active", "completed", "lost"], "status"),
    solidtimeProjectId: nullableString(project.solidtimeProjectId, "solidtimeProjectId"),
    driveFolderId: nullableString(project.driveFolderId, "driveFolderId"),
  };
}

export function parseContract(value: unknown): Contract {
  const contract = object(value, "contract");
  if (!Array.isArray(contract.projectIds)) invalid("projectIds");
  return {
    id: string(contract.id, "id"),
    clientId: string(contract.clientId, "clientId"),
    name: string(contract.name, "name"),
    start: string(contract.start, "start"),
    end: nullableString(contract.end, "end"),
    hourlyRate: number(contract.hourlyRate, "hourlyRate"),
    projectIds: contract.projectIds.map((id: unknown) => string(id, "projectIds")),
    projectRates: record(contract.projectRates, "projectRates", number),
    ...(contract.hoursRange === undefined ? {} : { hoursRange: hoursRange(contract.hoursRange, "hoursRange") }),
    ...(contract.projectHoursRanges === undefined ? {} : {
      projectHoursRanges: record(contract.projectHoursRanges, "projectHoursRanges", hoursRange),
    }),
    renewalOutlook: oneOf(contract.renewalOutlook, ["likely", "undecided", "ending"], "renewalOutlook"),
  };
}

export function parseHoursRangeOverride(value: unknown): HoursRangeOverrideRecord {
  const override = object(value, "hoursRangeOverride");
  return {
    contractId: string(override.contractId, "contractId"),
    projectId: nullableString(override.projectId, "projectId"),
    month: parseMonth(override.month),
    range: hoursRange(override.range, "range"),
    note: string(override.note, "note"),
  };
}
