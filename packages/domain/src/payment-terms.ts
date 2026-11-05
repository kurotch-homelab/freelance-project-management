export interface PaymentTerms {
  readonly closingDay: number | "end";
  readonly paymentMonthOffset: number;
  readonly paymentDay: number | "end";
}

export interface InvoiceDates {
  readonly invoiceDate: string;
  readonly dueDate: string;
}

function assertDay(day: number | "end", name: string): void {
  if (day !== "end" && (!Number.isInteger(day) || day < 1 || day > 31)) {
    throw new RangeError(`${name} must be an integer from 1 to 31 or "end"`);
  }
}

/** 対象月に依存しない支払条件の値域を検証する。 */
export function validatePaymentTerms(terms: PaymentTerms): void {
  assertDay(terms.closingDay, "closingDay");
  assertDay(terms.paymentDay, "paymentDay");
  if (
    !Number.isInteger(terms.paymentMonthOffset) ||
    terms.paymentMonthOffset < 0 ||
    terms.paymentMonthOffset > 12
  ) {
    throw new RangeError("paymentMonthOffset must be an integer from 0 to 12");
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dateInMonth(year: number, month: number, day: number | "end"): string {
  const lastDay = daysInMonth(year, month);
  const actualDay = day === "end" ? lastDay : Math.min(day, lastDay);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(actualDay).padStart(2, "0")}`;
}

/** 対象月と支払条件から、月末を超える日を補正した請求日と支払期日を求める。 */
export function invoiceDates(month: string, terms: PaymentTerms): InvoiceDates {
  if (month.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError("month must be a valid month in YYYY-MM format");
  }
  validatePaymentTerms(terms);

  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const paymentMonthIndex = monthNumber - 1 + terms.paymentMonthOffset;
  const paymentYear = year + Math.floor(paymentMonthIndex / 12);
  const paymentMonth = (paymentMonthIndex % 12) + 1;
  if (paymentYear > 9999) {
    throw new RangeError("dueDate must have a four-digit year");
  }

  const invoiceDate = dateInMonth(year, monthNumber, terms.closingDay);
  const dueDate = dateInMonth(paymentYear, paymentMonth, terms.paymentDay);
  if (dueDate < invoiceDate) {
    throw new RangeError("dueDate must not be before invoiceDate");
  }

  return { invoiceDate, dueDate };
}
