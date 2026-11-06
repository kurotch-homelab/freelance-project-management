import type { Contract } from "@fpm/domain";
import type { ColumnType } from "kysely";
import type { ClientRecord, SyncRecord } from "./types.ts";

/** pg returns bigint columns as strings; SQLite and PGlite can return numbers. */
export type StoredInteger = number | string | bigint;
type Integer = ColumnType<StoredInteger, number, number>;
type NullableInteger = ColumnType<StoredInteger | null, number | null, number | null>;

export interface ClientsTable {
  id: string;
  name: string;
  closing_day: string;
  payment_month_offset: number;
  payment_day: string;
  subject_template: string;
  line_grouping: ClientRecord["lineGrouping"];
  archived: number;
  drive_folder_id: string | null;
}

export interface ProjectsTable {
  id: string;
  client_id: string | null;
  name: string;
  archived: number;
  hourly_rate: number | null;
  drive_folder_id: string | null;
}

export interface ContractsTable {
  id: string;
  client_id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  min_seconds: NullableInteger;
  max_seconds: NullableInteger;
  has_hours_range: number;
  has_project_hours_ranges: number;
  renewal_outlook: Contract["renewalOutlook"];
}

export interface ContractProjectsTable {
  contract_id: string;
  project_id: string;
  position: number;
  min_seconds: NullableInteger;
  max_seconds: NullableInteger;
  has_hours_range: number;
}

export interface HoursRangeOverridesTable {
  id: string;
  contract_id: string;
  project_id: string | null;
  month: string;
  min_seconds: NullableInteger;
  max_seconds: NullableInteger;
  note: string;
  recorded_at: string;
}

export interface TimeEntriesTable {
  id: string;
  solidtime_project_id: string | null;
  date: string;
  seconds: Integer;
  billable: number;
  start_at: string | null;
  end_at: string | null;
}

export interface AbsencesTable {
  date: string;
  seconds: Integer;
}

export interface SyncRecordsTable {
  id: string;
  source: SyncRecord["source"];
  status: SyncRecord["status"];
  finished_at: string;
  error: string | null;
}

export interface Schema {
  clients: ClientsTable;
  projects: ProjectsTable;
  contracts: ContractsTable;
  contract_projects: ContractProjectsTable;
  hours_range_overrides: HoursRangeOverridesTable;
  time_entries: TimeEntriesTable;
  absences: AbsencesTable;
  sync_records: SyncRecordsTable;
}
