import { describe, expect, it } from "vitest";
import { billableHours, consumptionTax, lineAmount, summarizeInvoice } from "./billing.ts";

const h = (hours: number, minutes = 0) => (hours * 60 + minutes) * 60;

describe("billableHours: 稼働秒数を小数第二位で切り捨てた請求時間にする", () => {
  it("37 時間 15 分は 37.25h", () => {
    expect(billableHours(h(37, 15))).toBe(37.25);
  });

  it("10 時間 1 分(10.0166…h)は 10.01h に切り捨てる", () => {
    expect(billableHours(h(10, 1))).toBe(10.01);
  });

  it.each([
    [0, 0],
    [35, 0],
    [36, 0.01],
    [71, 0.01],
    [72, 0.02],
    [3_599, 0.99],
    [3_600, 1],
    [3_601, 1],
  ])("%i 秒は %d h(0.01h = 36 秒の境界)", (seconds, hours) => {
    expect(billableHours(seconds)).toBe(hours);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "秒数 %d は受け付けない",
    (seconds) => {
      expect(() => billableHours(seconds)).toThrow(RangeError);
    },
  );
});

describe("lineAmount: 稼働秒数と時間単価から明細金額を出す(請求時間 × 単価、円未満切り捨て)", () => {
  it("37 時間 15 分 × 5,000 円 = 186,250 円", () => {
    expect(lineAmount(h(37, 15), 5_000)).toBe(186_250);
  });

  it("10 時間 1 分 × 5,000 円 = 10.01h 分の 50,050 円", () => {
    expect(lineAmount(h(10, 1), 5_000)).toBe(50_050);
  });

  it("10 時間 1 分 × 4,850 円 = 48,548.5 → 48,548 円", () => {
    expect(lineAmount(h(10, 1), 4_850)).toBe(48_548);
  });

  it("浮動小数の誤差が出やすい 1.13h(4,068 秒)× 5,000 円 = 5,650 円", () => {
    expect(lineAmount(4_068, 5_000)).toBe(5_650);
  });

  it("単価 0 円なら 0 円", () => {
    expect(lineAmount(h(1), 0)).toBe(0);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("単価 %d は受け付けない", (rate) => {
    expect(() => lineAmount(h(1), rate)).toThrow(RangeError);
  });

  it("計算の途中で安全整数を超える値は受け付けない", () => {
    expect(() => lineAmount(h(1), Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe("consumptionTax: 税抜合計 × 10%、円未満切り捨て", () => {
  it("186,250 円の税は 18,625 円", () => {
    expect(consumptionTax(186_250)).toBe(18_625);
  });

  it("50,050 円の税は 5,005 円", () => {
    expect(consumptionTax(50_050)).toBe(5_005);
  });

  it("48,548 円の税は 4,854 円(4,854.8 を切り捨て)", () => {
    expect(consumptionTax(48_548)).toBe(4_854);
  });

  it.each([-1, 0.5, Number.NaN])("税抜合計 %d は受け付けない", (subtotal) => {
    expect(() => consumptionTax(subtotal)).toThrow(RangeError);
  });
});

describe("summarizeInvoice: 明細を合計し、消費税は請求書合計で 1 回だけ端数処理する", () => {
  it("1 行: 5,000 円/h、37 時間 15 分", () => {
    expect(summarizeInvoice([{ seconds: h(37, 15), hourlyRate: 5_000 }])).toEqual({
      lines: [{ hours: 37.25, hourlyRate: 5_000, amount: 186_250 }],
      subtotal: 186_250,
      tax: 18_625,
      total: 204_875,
    });
  });

  it("単価が変わった月は単価ごとの行を合計する: 20h × 5,000 + 10h × 6,000", () => {
    const result = summarizeInvoice([
      { seconds: h(20), hourlyRate: 5_000 },
      { seconds: h(10), hourlyRate: 6_000 },
    ]);
    expect(result.subtotal).toBe(160_000);
    expect(result.tax).toBe(16_000);
    expect(result.total).toBe(176_000);
  });

  it("税は行ごとではなく合計で切り捨てる", () => {
    // 行ごとに切り捨てると 4,854 + 4,854 = 9,708 円、合計で切り捨てると 9,709 円
    const result = summarizeInvoice([
      { seconds: h(10, 1), hourlyRate: 4_850 },
      { seconds: h(10, 1), hourlyRate: 4_850 },
    ]);
    expect(result.subtotal).toBe(97_096);
    expect(result.tax).toBe(9_709);
  });

  it("稼働ゼロ(0 秒)の行は明細に出さない", () => {
    const result = summarizeInvoice([
      { seconds: h(10), hourlyRate: 5_000 },
      { seconds: 0, hourlyRate: 6_000 },
    ]);
    expect(result.lines).toHaveLength(1);
  });

  it("全行が 0 秒なら明細なし・0 円", () => {
    expect(
      summarizeInvoice([
        { seconds: 0, hourlyRate: 5_000 },
        { seconds: 0, hourlyRate: 6_000 },
      ]),
    ).toEqual({ lines: [], subtotal: 0, tax: 0, total: 0 });
  });

  it("入力が空なら明細なし・0 円", () => {
    expect(summarizeInvoice([])).toEqual({ lines: [], subtotal: 0, tax: 0, total: 0 });
  });

  it("0.01h 未満でも稼働があれば明細に残す(0 円と稼働ゼロは別もの)", () => {
    expect(summarizeInvoice([{ seconds: 35, hourlyRate: 5_000 }]).lines).toEqual([
      { hours: 0, hourlyRate: 5_000, amount: 0 },
    ]);
  });

  it("単価 0 円の行も明細に残す", () => {
    expect(summarizeInvoice([{ seconds: h(1), hourlyRate: 0 }]).lines).toEqual([
      { hours: 1, hourlyRate: 0, amount: 0 },
    ]);
  });

  it("0 秒の行でも単価が不正なら受け付けない", () => {
    expect(() => summarizeInvoice([{ seconds: 0, hourlyRate: -1 }])).toThrow(RangeError);
  });
});
