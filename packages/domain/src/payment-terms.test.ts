import { describe, expect, it } from "vitest";
import { invoiceDates, type PaymentTerms } from "./payment-terms.ts";

// 日付はタイムゾーンの影響を受けないよう "YYYY-MM-DD" の文字列で扱う。対象月は "YYYY-MM"。
const endEnd1: PaymentTerms = { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" };

describe("invoiceDates: 対象月と取引先の支払条件から請求日と支払期日を出す", () => {
  it("月末締め翌月末払い、11 月分 → 請求日 11/30、支払期日 12/31", () => {
    expect(invoiceDates("2026-11", endEnd1)).toEqual({
      invoiceDate: "2026-11-30",
      dueDate: "2026-12-31",
    });
  });

  it("年をまたぐ: 月末締め翌月末払い、12 月分 → 12/31、翌年 1/31", () => {
    expect(invoiceDates("2026-12", endEnd1)).toEqual({
      invoiceDate: "2026-12-31",
      dueDate: "2027-01-31",
    });
  });

  it("月末締め翌々月 10 日払い、11 月分 → 11/30、翌年 1/10", () => {
    expect(
      invoiceDates("2026-11", { closingDay: "end", paymentMonthOffset: 2, paymentDay: 10 }),
    ).toEqual({ invoiceDate: "2026-11-30", dueDate: "2027-01-10" });
  });

  it("20 日締め翌月 15 日払い、11 月分 → 11/20、12/15", () => {
    expect(
      invoiceDates("2026-11", { closingDay: 20, paymentMonthOffset: 1, paymentDay: 15 }),
    ).toEqual({ invoiceDate: "2026-11-20", dueDate: "2026-12-15" });
  });

  it("月末締め翌月末払い、1 月分 → 支払期日は 2 月の末日(平年は 2/28)", () => {
    expect(invoiceDates("2027-01", endEnd1).dueDate).toBe("2027-02-28");
  });

  it("うるう年の 2 月末: 2028 年 1 月分 → 2/29", () => {
    expect(invoiceDates("2028-01", endEnd1).dueDate).toBe("2028-02-29");
  });

  it("支払日 31 日指定で 2 月に当たるときは月末に寄せる", () => {
    expect(
      invoiceDates("2027-01", { closingDay: "end", paymentMonthOffset: 1, paymentDay: 31 }).dueDate,
    ).toBe("2027-02-28");
  });

  it("締め日 30 日指定で 2 月分のときは月末に寄せる", () => {
    expect(
      invoiceDates("2027-02", { closingDay: 30, paymentMonthOffset: 1, paymentDay: "end" })
        .invoiceDate,
    ).toBe("2027-02-28");
  });

  it("当月払い(offset 0): 月末締め当月末払い → 同じ日", () => {
    expect(
      invoiceDates("2026-11", { closingDay: "end", paymentMonthOffset: 0, paymentDay: "end" }),
    ).toEqual({ invoiceDate: "2026-11-30", dueDate: "2026-11-30" });
  });

  it("支払期日が請求日より前になる条件は受け付けない(20 日締め当月 10 日払い)", () => {
    expect(() =>
      invoiceDates("2026-11", { closingDay: 20, paymentMonthOffset: 0, paymentDay: 10 }),
    ).toThrow(RangeError);
  });

  it.each(["2026-13", "2026-00", "2026-1", "26-11", "2026/11", ""])(
    "対象月 %s は受け付けない",
    (month) => {
      expect(() => invoiceDates(month, endEnd1)).toThrow(RangeError);
    },
  );

  it.each([
    { closingDay: 0, paymentMonthOffset: 1, paymentDay: "end" },
    { closingDay: 32, paymentMonthOffset: 1, paymentDay: "end" },
    { closingDay: 1.5, paymentMonthOffset: 1, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: -1, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: 13, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: 1, paymentDay: 0 },
  ] as PaymentTerms[])("不正な支払条件 %o は受け付けない", (terms) => {
    expect(() => invoiceDates("2026-11", terms)).toThrow(RangeError);
  });

  it.each([
    ["1900-01", "1900-02-28"],
    ["2000-01", "2000-02-29"],
    ["2100-01", "2100-02-28"],
  ])("100 年・400 年ごとのうるう年の規則: %s 分の翌月末は %s", (month, expected) => {
    expect(invoiceDates(month, endEnd1).dueDate).toBe(expected);
  });

  it("30 日の月への補正: 4 月分、31 日締め翌々月 31 日払い → 4/30、6/30", () => {
    expect(
      invoiceDates("2026-04", { closingDay: 31, paymentMonthOffset: 2, paymentDay: 31 }),
    ).toEqual({ invoiceDate: "2026-04-30", dueDate: "2026-06-30" });
  });

  it("補正すると同じ日になる当月払いは受け付ける: 2028 年 2 月分、31 日締め当月 30 日払い", () => {
    expect(
      invoiceDates("2028-02", { closingDay: 31, paymentMonthOffset: 0, paymentDay: 30 }),
    ).toEqual({ invoiceDate: "2028-02-29", dueDate: "2028-02-29" });
  });

  it("日付指定の当月払い: 20 日締め当月 25 日払い", () => {
    expect(
      invoiceDates("2026-11", { closingDay: 20, paymentMonthOffset: 0, paymentDay: 25 }),
    ).toEqual({ invoiceDate: "2026-11-20", dueDate: "2026-11-25" });
  });

  it("12 か月後(上限)でうるう年から平年へ: 2028 年 2 月分 → 2029-02-28", () => {
    expect(
      invoiceDates("2028-02", { closingDay: "end", paymentMonthOffset: 12, paymentDay: "end" }).dueDate,
    ).toBe("2029-02-28");
  });

  it.each([
    { closingDay: "end", paymentMonthOffset: 1, paymentDay: 32 },
    { closingDay: "end", paymentMonthOffset: 1, paymentDay: 1.5 },
    { closingDay: Number.NaN, paymentMonthOffset: 1, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: Number.POSITIVE_INFINITY, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: 1.5, paymentDay: "end" },
    { closingDay: "end", paymentMonthOffset: 1, paymentDay: Number.NEGATIVE_INFINITY },
  ] as PaymentTerms[])("不正な数値 %o は受け付けない", (terms) => {
    expect(() => invoiceDates("2026-11", terms)).toThrow(RangeError);
  });

  it.each(["2026-11\n", " 2026-11", "2026-11 "])("前後に余分な文字がある対象月 %j は受け付けない", (month) => {
    expect(() => invoiceDates(month, endEnd1)).toThrow(RangeError);
  });
});
