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
