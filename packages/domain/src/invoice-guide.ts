import { summarizeInvoice } from "./billing.ts";
import { contractCoverage, validateContracts, type Contract } from "./contracts.ts";
import { formatDate, parseDate } from "./date.ts";
import type { DailyWork } from "./forecast/weekday-average.ts";
import { invoiceDates, type InvoiceDates, type PaymentTerms } from "./payment-terms.ts";

export interface InvoiceGuideProject {
  readonly id: string;
  readonly clientId: string | null;
  readonly name: string;
  readonly hourlyRate: number | null;
  readonly work: readonly DailyWork[];
}

export interface InvoiceGuideInput {
  readonly month: string;
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly subjectTemplate: string;
    readonly paymentTerms: PaymentTerms;
    readonly lineGrouping: "project" | "contract";
  };
  readonly contracts: readonly Contract[];
  readonly projects: readonly InvoiceGuideProject[];
}

export interface InvoiceGuideLine {
  readonly item: string;
  readonly quantity: number;
  readonly unit: "時間";
  readonly unitPrice: number;
  readonly amount: number;
}

export interface InvoiceGuide extends InvoiceDates {
  readonly clientName: string;
  readonly subject: string;
  readonly lines: readonly InvoiceGuideLine[];
  readonly warnings: readonly { readonly kind: "missingRate"; readonly projectId: string; readonly projectName: string; readonly seconds: number }[];
  readonly note: string | null;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
}

interface LineGroup {
  readonly name: string;
  readonly contractId: string | null;
  readonly hourlyRate: number;
  readonly firstProjectIndex: number;
  readonly projects: Map<string, { readonly name: string; seconds: number }>;
  seconds: number;
}

interface Period {
  readonly start: number;
  readonly end: number;
}

/** 契約期間を対象月に切り詰め、重なる期間と隣接する期間をまとめる。 */
function contractPeriods(contracts: readonly Contract[], monthStart: string, monthEnd: string): Period[] {
  const periods = contracts.flatMap<Period>((contract) => {
    const start = contract.start < monthStart ? monthStart : contract.start;
    const end = contract.end === null || contract.end > monthEnd ? monthEnd : contract.end;
    return start > end ? [] : [{ start: parseDate(start, "start"), end: parseDate(end, "end") }];
  }).sort((a, b) => a.start - b.start);
  const merged: Period[] = [];
  for (const period of periods) {
    const previous = merged.at(-1);
    if (previous !== undefined && period.start <= previous.end + 1) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, period.end) };
    } else {
      merged.push(period);
    }
  }
  return merged;
}

function shortDate(day: number): string {
  const date = formatDate(day);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function formatWorkTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours === 0) {
    return `${minutes}分`;
  }
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

/** 取引先の対象月の実績を、freee に入力する請求書ガイドにまとめる。 */
export function invoiceGuide(input: InvoiceGuideInput): InvoiceGuide | null {
  const { month, client, contracts, projects } = input;
  const dates = invoiceDates(month, client.paymentTerms);
  validateContracts(contracts);
  if (contracts.some((contract) => contract.clientId !== client.id)) {
    throw new RangeError("contract.clientId must match client.id");
  }
  const monthStart = `${month}-01`;
  const monthEnd = invoiceDates(month, {
    closingDay: "end", paymentMonthOffset: 0, paymentDay: "end",
  }).invoiceDate;
  const year = month.slice(0, 4);
  const paddedMonth = month.slice(5, 7);
  const monthNumber = String(Number(paddedMonth));
  const monthLabel = `${year}年${monthNumber}月分`;
  const groups = new Map<string, Map<number, LineGroup>>();
  const projectIds = new Set<string>();
  const monthlyContracts = contracts.filter((contract) =>
    contract.start <= monthEnd && (contract.end === null || contract.end >= monthStart),
  );
  const warnings: { kind: "missingRate"; projectId: string; projectName: string; seconds: number }[] = [];

  for (const [projectIndex, project] of projects.entries()) {
    if (project.clientId !== client.id) {
      throw new RangeError("project.clientId must match client.id");
    }
    if (projectIds.has(project.id)) {
      throw new RangeError("project.id must be unique");
    }
    projectIds.add(project.id);
    let projectSeconds = 0;
    for (const work of project.work) {
      parseDate(work.date, "work.date");
      if (!Number.isSafeInteger(work.seconds) || work.seconds < 0) {
        throw new RangeError("work.seconds must be a non-negative safe integer");
      }
      if (work.seconds === 0 || work.date < monthStart || work.date > monthEnd) {
        continue;
      }
      projectSeconds += work.seconds;
      if (!Number.isSafeInteger(projectSeconds)) throw new RangeError("total seconds must be a safe integer");
      if (project.hourlyRate === null) continue;
      const coverage = contractCoverage(contracts, project.id, work.date);
      if (coverage === null || coverage.assumesRenewal) {
        throw new RangeError("work.date must be covered by an actual contract");
      }
      const { contract } = coverage;
      const hourlyRate = project.hourlyRate;
      const key = client.lineGrouping === "project" ? project.id : contract.id;
      const rates = groups.get(key) ?? new Map<number, LineGroup>();
      groups.set(key, rates);
      const group = rates.get(hourlyRate) ?? {
        name: client.lineGrouping === "project" ? project.name : contract.name,
        contractId: client.lineGrouping === "project" ? null : contract.id,
        hourlyRate,
        firstProjectIndex: projectIndex,
        projects: new Map<string, { readonly name: string; seconds: number }>(),
        seconds: 0,
      };
      rates.set(hourlyRate, group);
      const projectWork = group.projects.get(project.id) ?? { name: project.name, seconds: 0 };
      projectWork.seconds += work.seconds;
      group.projects.set(project.id, projectWork);
      group.seconds += work.seconds;
      if (!Number.isSafeInteger(group.seconds)) {
        throw new RangeError("total seconds must be a safe integer");
      }
    }
    if (project.hourlyRate === null && projectSeconds > 0) {
      warnings.push({ kind: "missingRate", projectId: project.id, projectName: project.name, seconds: projectSeconds });
    }
  }

  if (groups.size === 0 && warnings.length === 0) {
    return null;
  }
  const lines = Array.from(groups.values()).flatMap((rates) =>
    Array.from(rates.values(), (group) => {
      // 実績の日付ではなく、対象の契約期間を表示する。
      const matchingContracts = monthlyContracts.filter((contract) =>
        (group.contractId === null || contract.id === group.contractId) &&
        Array.from(group.projects.keys()).some((projectId) =>
          contract.projectIds.includes(projectId),
        ),
      );
      return { ...group, periods: contractPeriods(matchingContracts, monthStart, monthEnd) };
    }),
  ).sort((a, b) =>
    a.periods[0]!.start - b.periods[0]!.start || a.firstProjectIndex - b.firstProjectIndex,
  );
  const entries = lines.map((line) => {
    const showProjects = line.contractId !== null && groups.get(line.contractId)!.size > 1;
    const showPeriods = line.contractId !== null &&
      monthlyContracts.filter((contract) => contract.name === line.name).length > 1;
    const labels: string[] = [];
    if (showProjects) {
      labels.push(Array.from(line.projects.values(), (project) => project.name).join("、"));
    }
    if (showPeriods) {
      labels.push(line.periods.map(({ start, end }) => `${shortDate(start)}〜${shortDate(end)}`).join("、"));
    }
    const suffix = labels.length === 0 ? "" : `(${labels.join("・")})`;
    return {
      item: `${line.name} ${monthLabel}${suffix}`,
      seconds: line.seconds,
      hourlyRate: line.hourlyRate,
      breakdown: Array.from(line.projects.values(), ({ name, seconds }) =>
        `${name} ${formatWorkTime(seconds)}`,
      ).join("、"),
    };
  });

  // 秒数を行ごとに合算してから切り捨て、税も請求書全体で一度だけ計算する。
  const summary = summarizeInvoice(entries);
  return {
    clientName: client.name,
    warnings,
    subject: client.subjectTemplate
      .replaceAll("{YYYY}", year)
      .replaceAll("{MM}", paddedMonth)
      .replaceAll("{M}", monthNumber),
    ...dates,
    lines: summary.lines.map((line, index) => ({
      item: entries[index]!.item,
      quantity: line.hours,
      unit: "時間",
      unitPrice: line.hourlyRate,
      amount: line.amount,
    })),
    note: client.lineGrouping === "contract"
      ? entries.map((entry) => `${entry.item} の内訳: ${entry.breakdown}`).join("\n")
      : null,
    subtotal: summary.subtotal,
    tax: summary.tax,
    total: summary.total,
  };
}
