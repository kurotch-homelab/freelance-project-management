import { groupInvoiceWork, summarizeInvoice, type RatedDailyWork, type InvoiceWork } from "./billing.ts";
import { contractCoverage, validateContracts, type Contract } from "./contracts.ts";
import { formatDate, parseDate } from "./date.ts";
import { invoiceDates, type InvoiceDates, type PaymentTerms } from "./payment-terms.ts";

export interface InvoiceGuideProject {
  readonly id: string;
  readonly clientId: string | null;
  readonly name: string;
  readonly hourlyRate: number | null;
  readonly work: readonly RatedDailyWork[];
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
  readonly warnings: readonly { readonly kind: "missingRate" | "missingContract"; readonly projectId: string; readonly projectName: string; readonly seconds: number }[];
  readonly note: string | null;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
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
  const invoiceWork: InvoiceWork[] = [];
  const projectIds = new Set<string>();
  const monthlyContracts = contracts.filter((contract) =>
    contract.start <= monthEnd && (contract.end === null || contract.end >= monthStart),
  );
  const warnings: { kind: "missingRate" | "missingContract"; projectId: string; projectName: string; seconds: number }[] = [];

  for (const project of projects) {
    if (project.clientId !== client.id) {
      throw new RangeError("project.clientId must match client.id");
    }
    if (projectIds.has(project.id)) {
      throw new RangeError("project.id must be unique");
    }
    projectIds.add(project.id);
    let projectSeconds = 0;
    let missingContractSeconds = 0;
    let missingRateSeconds = 0;
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
      const coverage = contractCoverage(contracts, project.id, work.date);
      const contractId = coverage !== null && !coverage.assumesRenewal ? coverage.contract.id : null;
      if (contractId === null) missingContractSeconds += work.seconds;
      if (work.hourlyRate === null) missingRateSeconds += work.seconds;
      invoiceWork.push({ projectId: project.id, contractId, hourlyRate: work.hourlyRate, seconds: work.seconds });
    }
    if (client.lineGrouping === "contract" && missingContractSeconds > 0) {
      warnings.push({ kind: "missingContract", projectId: project.id, projectName: project.name, seconds: missingContractSeconds });
    }
    if (missingRateSeconds > 0) {
      warnings.push({ kind: "missingRate", projectId: project.id, projectName: project.name, seconds: missingRateSeconds });
    }
  }

  const groups = groupInvoiceWork(invoiceWork, client.lineGrouping);
  if (groups.length === 0 && warnings.length === 0) {
    return null;
  }
  const projectById = new Map(projects.map((project, index) => [project.id, { ...project, index }]));
  const lines = groups.map((group) => {
    const firstProject = projectById.get(group.projects.keys().next().value!)!;
    const contract = contracts.find((candidate) => candidate.id === group.contractId);
    return {
      ...group,
      name: contract?.name ?? firstProject.name,
      firstProjectIndex: firstProject.index,
      periods: contract === undefined ? [] : contractPeriods([contract], monthStart, monthEnd),
    };
  }).sort((a, b) =>
    (a.periods[0]?.start ?? parseDate(monthStart, "month")) - (b.periods[0]?.start ?? parseDate(monthStart, "month")) ||
    a.firstProjectIndex - b.firstProjectIndex,
  );
  const entries = lines.map((line) => {
    const samePeriodName = lines.some((other) => other.contractId !== line.contractId &&
      other.name === line.name && JSON.stringify(other.periods) === JSON.stringify(line.periods));
    const showProjects = line.contractId !== null && (samePeriodName ||
      groups.filter((group) => group.contractId === line.contractId).length > 1);
    const showPeriods = line.contractId !== null &&
      monthlyContracts.filter((contract) => contract.name === line.name).length > 1;
    const labels: string[] = [];
    if (showProjects) {
      labels.push(Array.from(line.projects.keys(), (id) => projectById.get(id)!.name).join("、"));
    }
    if (showPeriods) {
      labels.push(line.periods.map(({ start, end }) => `${shortDate(start)}〜${shortDate(end)}`).join("、"));
    }
    const suffix = labels.length === 0 ? "" : `(${labels.join("・")})`;
    return {
      item: `${line.name} ${monthLabel}${suffix}`,
      seconds: line.seconds,
      hourlyRate: line.hourlyRate,
      breakdown: Array.from(line.projects, ([id, seconds]) =>
        `${projectById.get(id)!.name} ${formatWorkTime(seconds)}`,
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
      ? entries.map((entry) => {
        const sameItem = entries.filter((other) => other.item === entry.item).length > 1;
        const rate = sameItem ? `・${entry.hourlyRate.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} 円` : "";
        return `${entry.item}${rate} の内訳: ${entry.breakdown}`;
      }).join("\n")
      : null,
    subtotal: summary.subtotal,
    tax: summary.tax,
    total: summary.total,
  };
}
