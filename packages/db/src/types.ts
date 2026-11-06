import type { Contract, DailyWork, HoursRangeOverride, PaymentTerms } from "@fpm/domain";

export interface ClientRecord {
  readonly id: string;
  readonly name: string;
  readonly paymentTerms: PaymentTerms;
  readonly subjectTemplate: string;
  readonly lineGrouping: "project" | "contract";
  readonly archived: boolean;
  readonly driveFolderId: string | null;
}

export interface ProjectRecord {
  readonly id: string;
  readonly clientId: string | null;
  readonly name: string;
  readonly archived: boolean;
  readonly hourlyRate: number | null;
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

export type ClientBilling = Pick<ClientRecord, "paymentTerms" | "subjectTemplate" | "lineGrouping">;
export interface SolidtimeCatalog {
  readonly clients: readonly Pick<ClientRecord, "id" | "name" | "archived">[];
  readonly projects: readonly Omit<ProjectRecord, "driveFolderId">[];
}

export interface Repository {
  syncSolidtimeCatalog(catalog: SolidtimeCatalog): Promise<void>;
  replaceSolidtimeData(catalog: SolidtimeCatalog, period: DateRange, entries: readonly TimeEntryRecord[]): Promise<void>;
  updateClientBilling(id: string, billing: ClientBilling): Promise<void>;
  setClientDriveFolder(id: string, folderId: string): Promise<void>;
  setProjectDriveFolder(id: string, folderId: string): Promise<void>;
  getClient(id: string): Promise<ClientRecord | null>;
  listClients(): Promise<ClientRecord[]>;
  listProjects(filter?: ClientFilter & { readonly includeArchived?: boolean }): Promise<ProjectRecord[]>;
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
