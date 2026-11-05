import { billableHours, summarizeInvoice } from "./billing.ts";
import { contractCoverage, rateFor, validateContracts, type Contract } from "./contracts.ts";
import { formatDate, parseDate } from "./date.ts";
import type { DailyWork } from "./forecast/weekday-average.ts";
import { invoiceDates, type InvoiceDates, type PaymentTerms } from "./payment-terms.ts";

export interface InvoiceGuideProject {
  readonly id: string;
  readonly name: string;
  readonly work: readonly DailyWork[];
}

export interface InvoiceGuideInput {
  readonly month: string;
  readonly client: {
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
  readonly note: string | null;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
}

interface LineGroup {
  readonly name: string;
  readonly hourlyRate: number;
  readonly projects: Map<string, string>;
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

/** 取引先の対象月の実績を、freee に入力する請求書ガイドにまとめる。 */
export function invoiceGuide(input: InvoiceGuideInput): InvoiceGuide | null {
  const { month, client, contracts, projects } = input;
  const dates = invoiceDates(month, client.paymentTerms);
  validateContracts(contracts);
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
  const breakdown: string[] = [];

  for (const project of projects) {
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
      const coverage = contractCoverage(contracts, project.id, work.date);
      if (coverage === null || coverage.assumesRenewal) {
        throw new RangeError("work.date must be covered by an actual contract");
      }
      const { contract } = coverage;
      const hourlyRate = rateFor(contract, project.id);
      const key = client.lineGrouping === "project" ? project.id : contract.name;
      const rates = groups.get(key) ?? new Map<number, LineGroup>();
      groups.set(key, rates);
      const group = rates.get(hourlyRate) ?? {
        name: client.lineGrouping === "project" ? project.name : contract.name,
        hourlyRate,
        projects: new Map<string, string>(),
        seconds: 0,
      };
      rates.set(hourlyRate, group);
      group.projects.set(project.id, project.name);
      group.seconds += work.seconds;
      projectSeconds += work.seconds;
      if (!Number.isSafeInteger(group.seconds) || !Number.isSafeInteger(projectSeconds)) {
        throw new RangeError("total seconds must be a safe integer");
      }
    }
    if (projectSeconds > 0) {
      breakdown.push(`${project.name} ${billableHours(projectSeconds)} 時間`);
    }
  }

  if (groups.size === 0) {
    return null;
  }
  const entries = Array.from(groups.values()).flatMap((rates) => {
    const lines = Array.from(rates.values(), (group) => {
      // 実績の日付ではなく、同じ単価で契約されている期間を表示する。
      const matchingContracts = contracts.filter((contract) =>
        (client.lineGrouping === "project" || contract.name === group.name) &&
        Array.from(group.projects.keys()).some((projectId) =>
          contract.projectIds.includes(projectId) && rateFor(contract, projectId) === group.hourlyRate,
        ),
      );
      return { ...group, periods: contractPeriods(matchingContracts, monthStart, monthEnd) };
    });
    return lines.map((line) => {
      let suffix = "";
      if (lines.length > 1) {
        // 同時期の単価の違いは期間では区別できないので、対象案件名を添える。
        const concurrentRates = client.lineGrouping === "contract" && lines.some((other) =>
          other !== line && line.periods.some((period) => other.periods.some((otherPeriod) =>
            period.start <= otherPeriod.end && otherPeriod.start <= period.end,
          )),
        );
        const label = concurrentRates
          ? Array.from(line.projects.values()).join("、")
          : line.periods.map(({ start, end }) => `${shortDate(start)}〜${shortDate(end)}`).join("、");
        suffix = `(${label})`;
      }
      return { item: `${line.name} ${monthLabel}${suffix}`, seconds: line.seconds, hourlyRate: line.hourlyRate };
    });
  });

  // 秒数を行ごとに合算してから切り捨て、税も請求書全体で一度だけ計算する。
  const summary = summarizeInvoice(entries);
  return {
    clientName: client.name,
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
    note: client.lineGrouping === "contract" ? `内訳: ${breakdown.join("、")}` : null,
    subtotal: summary.subtotal,
    tax: summary.tax,
    total: summary.total,
  };
}
