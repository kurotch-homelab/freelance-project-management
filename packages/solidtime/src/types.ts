import type { DailyWork } from "@fpm/domain";

export interface SolidtimeClientOptions {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly token: string;
  readonly timeZone: string;
  /** Per-request timeout including response body reads, in milliseconds. Defaults to 30,000. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ListTimeEntriesOptions {
  /** Inclusive calendar dates (YYYY-MM-DD) in the client's timeZone. */
  readonly from: string;
  readonly to: string;
  /** Defaults to 500; solidtime accepts 1 through 500. */
  readonly pageSize?: number;
}

export interface TimeEntry extends DailyWork {
  readonly userId: string;
  readonly id: string;
  readonly projectId: string | null;
  readonly start: string;
  readonly end: string;
  readonly description: string | null;
  readonly billable: boolean;
}

export interface TimeEntryWithRate extends TimeEntry {
  readonly hourlyRate: number | null;
}

export interface Client {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly clientId: string | null;
  /** Yen per hour, or null when no project rate is set. */
  readonly hourlyRate: number | null;
  readonly isBillable: boolean;
  readonly isArchived: boolean;
  readonly isPublic: boolean;
  /** Estimated duration in seconds. */
  readonly estimatedTime: number | null;
}

export interface SolidtimeClient {
  listTimeEntries(options: ListTimeEntriesOptions): Promise<TimeEntry[]>;
  listTimeEntriesWithRates(options: ListTimeEntriesOptions): Promise<TimeEntryWithRate[]>;
  listProjects(): Promise<Project[]>;
  listClients(): Promise<Client[]>;
  listProjectsWithRates(): Promise<Project[]>;
}
