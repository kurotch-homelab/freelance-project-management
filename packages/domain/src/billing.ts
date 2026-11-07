import type { DailyWork } from "./forecast/weekday-average.ts";

export interface RatedDailyWork extends DailyWork {
  readonly hourlyRate: number | null;
}

export interface InvoiceEntry {
  readonly seconds: number;
  readonly hourlyRate: number;
}

export interface InvoiceLine {
  readonly hours: number;
  readonly hourlyRate: number;
  readonly amount: number;
}

export interface InvoiceSummary {
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
}

export interface InvoiceWork {
  readonly projectId: string;
  readonly contractId: string | null;
  readonly seconds: number;
  readonly hourlyRate: number | null;
}

export interface InvoiceWorkGroup extends InvoiceEntry {
  readonly contractId: string | null;
  readonly projects: ReadonlyMap<string, number>;
}

/** 実績と着地見込みで共通の明細集約。契約のない稼働は案件ごとの行にする。 */
export function groupInvoiceWork(work: readonly InvoiceWork[], grouping: "project" | "contract"): InvoiceWorkGroup[] {
  const groups = new Map<string, { contractId: string | null; hourlyRate: number; seconds: number; projects: Map<string, number> }>();
  for (const row of work) {
    if (!Number.isFinite(row.seconds) || row.seconds < 0 || row.seconds > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("seconds must be a non-negative safe number");
    }
    if (row.seconds === 0 || row.hourlyRate === null) continue;
    const contractId = grouping === "contract" ? row.contractId : null;
    const key = JSON.stringify([contractId === null ? "project" : "contract", contractId ?? row.projectId, row.hourlyRate]);
    const group = groups.get(key) ?? { contractId, hourlyRate: row.hourlyRate, seconds: 0, projects: new Map<string, number>() };
    group.seconds += row.seconds;
    if (group.seconds > Number.MAX_SAFE_INTEGER) throw new RangeError("total seconds must not exceed the safe integer range");
    group.projects.set(row.projectId, (group.projects.get(row.projectId) ?? 0) + row.seconds);
    groups.set(key, group);
  }
  // 予測の小数秒も明細行に合算してから切り捨てる。
  return Array.from(groups.values(), (group) => ({ ...group, seconds: Math.floor(group.seconds) }));
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function billableHundredths(seconds: number): number {
  assertNonNegativeSafeInteger(seconds, "seconds");
  return Math.floor(seconds / 36);
}

function amountFromHundredths(hundredths: number, hourlyRate: number): number {
  // solidtime rates are hundredths of currency, including for JPY.
  const scaledRate = hourlyRate * 100;
  const rateCents = Math.round(scaledRate);
  assertNonNegativeSafeInteger(rateCents, "hourlyRate in hundredths");
  if (hourlyRate < 0 || Math.abs(scaledRate - rateCents) > Number.EPSILON * Math.max(1, Math.abs(scaledRate))) {
    throw new RangeError("hourlyRate must have at most two decimal places");
  }
  const product = hundredths * rateCents;
  assertNonNegativeSafeInteger(product, "hundredths * rateCents");
  return Math.floor(product / 10_000);
}

/** 稼働秒数を小数第二位までの請求時間に切り捨てる。 */
export function billableHours(seconds: number): number {
  return billableHundredths(seconds) / 100;
}

/** 稼働秒数と円単位の時間単価から、円未満を切り捨てた明細金額を求める。 */
export function lineAmount(seconds: number, hourlyRate: number): number {
  return amountFromHundredths(billableHundredths(seconds), hourlyRate);
}

/** 円単位の税抜合計に対する消費税 10% を、円未満切り捨てで求める。 */
export function consumptionTax(subtotal: number): number {
  assertNonNegativeSafeInteger(subtotal, "subtotal");
  return Math.floor(subtotal / 10);
}

/** 案件・単価ごとに集計済みの稼働から、請求書の明細と合計を求める。 */
export function summarizeInvoice(
  entries: readonly InvoiceEntry[],
): InvoiceSummary {
  const lines = entries.flatMap<InvoiceLine>(({ seconds, hourlyRate }) => {
    const hundredths = billableHundredths(seconds);
    const amount = amountFromHundredths(hundredths, hourlyRate);
    if (seconds === 0) {
      return [];
    }

    return [
      {
        hours: hundredths / 100,
        hourlyRate,
        amount,
      },
    ];
  });
  const subtotal = lines.reduce((sum, line) => {
    const nextSubtotal = sum + line.amount;
    assertNonNegativeSafeInteger(nextSubtotal, "subtotal");
    return nextSubtotal;
  }, 0);
  const tax = consumptionTax(subtotal);
  const total = subtotal + tax;
  assertNonNegativeSafeInteger(total, "total");

  return { lines, subtotal, tax, total };
}
