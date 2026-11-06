import { validatePaymentTerms, type PaymentTerms } from "./payment-terms.ts";

export interface ClientBilling {
  readonly paymentTerms: PaymentTerms;
  readonly subjectTemplate: string;
  readonly lineGrouping: "project" | "contract";
}

/** 保存前に、どの月でも請求書を作れる設定であることを検証する。 */
export function validateClientBilling(billing: ClientBilling): void {
  const terms = billing.paymentTerms;
  validatePaymentTerms(terms);
  if (terms.paymentMonthOffset === 0 &&
    (terms.paymentDay === "end" ? 31 : terms.paymentDay) <
    (terms.closingDay === "end" ? 31 : terms.closingDay)) {
    throw new RangeError("dueDate must not be before invoiceDate");
  }
  if (!billing.subjectTemplate.trim()) throw new RangeError("subjectTemplate must not be blank");
  if (billing.lineGrouping !== "project" && billing.lineGrouping !== "contract") {
    throw new RangeError("lineGrouping must be project or contract");
  }
}
