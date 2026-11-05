import type { Contract, DailyWork, HoursRangeOverride, PaymentTerms } from "@fpm/domain";

export interface ClientRecord {
  readonly id: string;
  readonly name: string;
  readonly paymentTerms: PaymentTerms;
  readonly subjectTemplate: string;
  readonly lineGrouping: "project" | "contract";
  readonly solidtimeClientId: string | null;
  readonly driveFolderId: string | null;
}

export interface ProjectRecord {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly status: "proposed" | "won" | "active" | "completed" | "lost";
  readonly solidtimeProjectId: string | null;
  readonly driveFolderId: string | null;
}

export interface ClientFilter {
  readonly clientId?: string;
}

/** Both bounds are inclusive calendar dates in YYYY-MM-DD format. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface HoursRangeOverrideRecord extends HoursRangeOverride {
  readonly contractId: string;
  readonly projectId: string | null;
}

export interface HoursRangeOverrideFilter {
  readonly month?: string;
  readonly contractId?: string;
}

export interface TimeEntryRecord extends DailyWork {
  readonly id: string;
  readonly solidtimeProjectId: string | null;
  readonly billable: boolean;
  readonly start?: string;
  readonly end?: string;
}

export interface ProjectDailyWork extends DailyWork {
  readonly projectId: string;
}

export interface UnlinkedSolidtimeProject {
  readonly solidtimeProjectId: string | null;
  readonly seconds: number;
}

export type Absences = Readonly<Record<string, number>>;
export type SyncSource = "solidtime" | "calendar" | "drive";

export interface SyncRecord {
  readonly source: SyncSource;
  readonly status: "success" | "failure";
  readonly finishedAt: string;
  readonly error: string | null;
}

export interface SyncStatus {
  readonly lastSuccessAt: string | null;
  readonly lastFailure: { readonly at: string; readonly error: string | null } | null;
}

export interface Repository {
  saveClient(client: ClientRecord): Promise<void>;
  getClient(id: string): Promise<ClientRecord | null>;
  listClients(): Promise<ClientRecord[]>;
  saveProject(project: ProjectRecord): Promise<void>;
  listProjects(filter?: ClientFilter): Promise<ProjectRecord[]>;
  findProjectBySolidtimeId(id: string): Promise<ProjectRecord | null>;
  saveContract(contract: Contract): Promise<void>;
  listContracts(filter?: ClientFilter): Promise<Contract[]>;
  saveHoursRangeOverride(override: HoursRangeOverrideRecord): Promise<void>;
  listHoursRangeOverrides(filter?: HoursRangeOverrideFilter): Promise<HoursRangeOverrideRecord[]>;
  replaceTimeEntries(period: DateRange, entries: readonly TimeEntryRecord[]): Promise<void>;
  listDailyWork(period: DateRange): Promise<ProjectDailyWork[]>;
  listUnlinkedSolidtimeProjects(period: DateRange): Promise<UnlinkedSolidtimeProject[]>;
  replaceAbsences(period: DateRange, absences: Absences): Promise<void>;
  listAbsences(period: DateRange): Promise<Absences>;
  recordSync(record: SyncRecord): Promise<void>;
  getSyncStatus(source: SyncSource): Promise<SyncStatus>;
}
