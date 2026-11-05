import type { DailyWork } from "@fpm/domain";

export interface SolidtimeClientOptions {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly token: string;
  readonly timeZone: string;
  readonly memberId?: string;
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
  readonly id: string;
  readonly projectId: string | null;
  readonly start: string;
  readonly end: string;
  readonly description: string | null;
  readonly billable: boolean;
}

export interface ProjectDailyWork extends DailyWork {
  readonly projectId: string;
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

export interface CreateProjectInput {
  readonly name: string;
  readonly clientId?: string | null;
  readonly hourlyRate?: number | null;
  readonly color?: string;
  readonly isBillable?: boolean;
  readonly isPublic?: boolean;
  readonly estimatedTime?: number | null;
}

export interface SolidtimeClient {
  listTimeEntries(options: ListTimeEntriesOptions): Promise<TimeEntry[]>;
  dailyWork(options: ListTimeEntriesOptions): Promise<ProjectDailyWork[]>;
  listProjects(): Promise<Project[]>;
  listClients(): Promise<Client[]>;
  createClient(name: string): Promise<Client>;
  createProject(input: CreateProjectInput): Promise<Project>;
  setProjectRate(projectId: string, hourlyRate: number): Promise<Project>;
}
