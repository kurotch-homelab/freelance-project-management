import { groupInvoiceWork, summarizeInvoice, type InvoiceSummary, type InvoiceWork } from "./billing.ts";
import { contractCoverage, validateContracts, type Contract } from "./contracts.ts";
import { parseDate } from "./date.ts";
import type { ForecastRow } from "./forecast/forecast-days.ts";
import {
  effectiveHoursRange,
  hoursRangeWarnings,
  type HoursRange,
  type HoursRangeOverride,
  type HoursRangeWarning,
} from "./hours-range.ts";

export interface MonthOutlookHoursRangeOverride extends HoursRangeOverride {
  readonly contractId: string;
  readonly projectId: string | null;
}

export interface MonthOutlookInput {
  readonly month: string;
  readonly asOf: string;
  readonly contracts: readonly Contract[];
  readonly projects: readonly { readonly id: string; readonly hourlyRate: number | null }[];
  readonly actual: readonly {
    readonly projectId: string;
    readonly date: string;
    readonly seconds: number;
    readonly hourlyRate: number | null;
  }[];
  readonly forecast: readonly ForecastRow[];
  readonly hoursRangeOverrides: readonly MonthOutlookHoursRangeOverride[];
}

export interface MonthOutlookProject {
  readonly projectId: string;
  readonly actualSeconds: number;
  readonly forecastSeconds: number;
  readonly landingSeconds: number;
  readonly warnings: readonly HoursRangeWarning[];
}

export interface MonthOutlook {
  readonly contractId: string;
  readonly contractName: string;
  readonly actualSeconds: number;
  readonly forecastSeconds: number;
  readonly landingSeconds: number;
  readonly assumesRenewal: boolean;
  readonly estimate: Pick<InvoiceSummary, "subtotal">;
  readonly warnings: readonly HoursRangeWarning[];
  readonly projects: readonly MonthOutlookProject[];
}

interface ProjectTotals {
  actualSeconds: number;
  forecastSeconds: number;
  readonly range: HoursRange;
}

interface ContractTotals {
  readonly contract: Contract;
  readonly range: HoursRange;
  readonly projects: Map<string, ProjectTotals>;
  assumesRenewal: boolean;
}

function assertActualSeconds(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new RangeError("actual seconds must be a non-negative safe integer");
  }
}

function addSeconds(total: number, seconds: number): number {
  const sum = total + seconds;
  if (!Number.isFinite(sum) || sum > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("total seconds must not exceed the safe integer range");
  }
  return sum;
}

/** 対象月の実績と予測を契約・案件ごとにまとめ、請求見込み額と目安時間の警告を返す。 */
export function monthOutlook(input: MonthOutlookInput): readonly MonthOutlook[] {
  const { month, asOf, contracts, actual, forecast, hoursRangeOverrides } = input;
  parseDate(`${month}-01`, "month");
  parseDate(asOf, "asOf");
  validateContracts(contracts);

  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const override of hoursRangeOverrides) {
    const contract = contractsById.get(override.contractId);
    if (contract === undefined) {
      throw new RangeError("hours range override must reference an existing contract");
    }
    if (override.projectId !== null && !contract.projectIds.includes(override.projectId)) {
      throw new RangeError("hours range override projectId must belong to the contract");
    }
  }

  const totals = new Map<string, ContractTotals>();
  const invoiceWork: InvoiceWork[] = [];
  for (const contract of contracts) {
    const overrides = hoursRangeOverrides.filter((override) => override.contractId === contract.id);
    const projectRanges = new Map(Object.entries(contract.projectHoursRanges ?? {}));
    const projects = new Map<string, ProjectTotals>();
    for (const projectId of contract.projectIds) {
      projects.set(projectId, {
        actualSeconds: 0,
        forecastSeconds: 0,
        range: effectiveHoursRange(
          projectRanges.get(projectId) ?? {},
          overrides.filter((override) => override.projectId === projectId),
          month,
        ),
      });
    }
    totals.set(contract.id, {
      contract,
      projects,
      range: effectiveHoursRange(
        contract.hoursRange ?? {},
        overrides.filter((override) => override.projectId === null),
        month,
      ),
      assumesRenewal: false,
    });
  }

  for (const work of actual) {
    parseDate(work.date, "actual.date");
    assertActualSeconds(work.seconds);
    if (work.date.slice(0, 7) !== month || work.date > asOf) {
      continue;
    }
    const coverage = contractCoverage(contracts, work.projectId, work.date);
    if (coverage === null || coverage.assumesRenewal) {
      throw new RangeError("actual.date must be covered by an actual contract");
    }
    const project = totals.get(coverage.contract.id)!.projects.get(work.projectId)!;
    project.actualSeconds = addSeconds(project.actualSeconds, work.seconds);
    invoiceWork.push({ ...work, contractId: coverage.contract.id });
  }

  // asOf より後の日の予測は forecastDays で生成する。ここでは対象月だけを絞り込む。
  for (const row of forecast) {
    parseDate(row.date, "forecast.date");
    if (!Number.isFinite(row.seconds) || row.seconds < 0) {
      throw new RangeError("forecast seconds must be a non-negative finite number");
    }
    if (row.date.slice(0, 7) !== month) {
      continue;
    }
    const coverage = contractCoverage(contracts, row.projectId, row.date);
    if (coverage === null) {
      throw new RangeError("forecast.date must be covered by a contract");
    }
    const group = totals.get(coverage.contract.id)!;
    const project = group.projects.get(row.projectId)!;
    project.forecastSeconds = addSeconds(project.forecastSeconds, row.seconds);
    group.assumesRenewal ||= coverage.assumesRenewal;
    invoiceWork.push({
      ...row, contractId: coverage.contract.id,
      hourlyRate: input.projects.find((p) => p.id === row.projectId)?.hourlyRate ?? null,
    });
  }

  return Array.from(totals.values()).filter((group) => {
    const { contract } = group;
    if (contract.start.slice(0, 7) <= month && (contract.end === null || contract.end.slice(0, 7) >= month)) {
      return true;
    }
    // 終了後の月は月初の被覆で判定できる。更新前提で延長されるのは案件の最後の契約だけ。
    // 予測行がない月も、更新前提の契約と目安時間の不足を表示する。
    group.assumesRenewal = contract.projectIds.some((projectId) => {
      const coverage = contractCoverage(contracts, projectId, `${month}-01`);
      return coverage?.contract.id === contract.id && coverage.assumesRenewal;
    });
    return group.assumesRenewal;
  }).sort((a, b) => a.contract.start.localeCompare(b.contract.start)).map((group) => {
    const { contract } = group;
    const projects = contract.projectIds.map<MonthOutlookProject>((projectId) => {
      const { actualSeconds, forecastSeconds: rawForecastSeconds, range } = group.projects.get(projectId)!;
      // 小数秒は日ごとではなく、契約 × 案件の月合計を切り捨てる。
      const forecastSeconds = Math.floor(rawForecastSeconds);
      return {
        projectId,
        actualSeconds,
        forecastSeconds,
        landingSeconds: addSeconds(actualSeconds, forecastSeconds),
        warnings: hoursRangeWarnings({ actualSeconds, forecastSeconds, range }),
      };
    });
    const actualSeconds = projects.reduce((sum, project) => addSeconds(sum, project.actualSeconds), 0);
    const forecastSeconds = projects.reduce((sum, project) => addSeconds(sum, project.forecastSeconds), 0);
    const { subtotal } = summarizeInvoice(groupInvoiceWork(
      invoiceWork.filter((row) => row.contractId === contract.id), "project",
    ));
    return {
      contractId: contract.id,
      contractName: contract.name,
      actualSeconds,
      forecastSeconds,
      landingSeconds: addSeconds(actualSeconds, forecastSeconds),
      assumesRenewal: group.assumesRenewal,
      estimate: { subtotal },
      warnings: hoursRangeWarnings({ actualSeconds, forecastSeconds, range: group.range }),
      projects,
    };
  });
}
