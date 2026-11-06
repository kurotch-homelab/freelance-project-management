import { describe, expect, it } from "vitest";
import { validateClientBilling, type ClientBilling } from "./client-billing.ts";

const billing: ClientBilling = {
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  subjectTemplate: "{YYYY}年{M}月分", lineGrouping: "project",
};

describe("validateClientBilling", () => {
  it.each(["", " ", "\t\n", "　"])("空白だけの件名 %j を拒否する", (subjectTemplate) => {
    expect(() => validateClientBilling({ ...billing, subjectTemplate })).toThrow(RangeError);
  });

  it.each([
    { closingDay: 31, paymentMonthOffset: 0, paymentDay: 30 },
    { closingDay: "end", paymentMonthOffset: 0, paymentDay: 30 },
    { closingDay: 20, paymentMonthOffset: 0, paymentDay: 1 },
  ] as const)("月によって支払日が締め日より前になる設定を拒否する: %o", (paymentTerms) => {
    expect(() => validateClientBilling({ ...billing, paymentTerms })).toThrow(RangeError);
  });

  it.each([
    { closingDay: "end", paymentMonthOffset: 0, paymentDay: 31 },
    { closingDay: 31, paymentMonthOffset: 0, paymentDay: "end" },
    { closingDay: 20, paymentMonthOffset: 0, paymentDay: 20 },
    { closingDay: 20, paymentMonthOffset: 0, paymentDay: 25 },
    { closingDay: 31, paymentMonthOffset: 1, paymentDay: 1 },
  ] as const)("同日以降に支払える設定は保存できる: %o", (paymentTerms) => {
    expect(() => validateClientBilling({ ...billing, paymentTerms })).not.toThrow();
  });
});
