import { describe, expect, it } from "vitest";
import {
  effectiveHoursRange,
  hoursRangeWarnings,
  type HoursRange,
  type HoursRangeOverride,
} from "./hours-range.ts";

const HOUR = 3_600;
const range140to180: HoursRange = { minHours: 140, maxHours: 180 };

describe("effectiveHoursRange: その月に効く目安時間(月ごとの上書きがあれば優先)", () => {
  const overrides: HoursRangeOverride[] = [
    { month: "2026-12", range: { minHours: 140, maxHours: 200 }, note: "年末の追加対応で合意" },
  ];

  it("上書きのある月は上書きを使う", () => {
    expect(effectiveHoursRange(range140to180, overrides, "2026-12")).toEqual({ minHours: 140, maxHours: 200 });
  });

  it("上書きのない月は契約の目安時間を使う", () => {
    expect(effectiveHoursRange(range140to180, overrides, "2026-11")).toEqual(range140to180);
  });

  it("上書きで片方だけ外す(上限なし)こともできる", () => {
    expect(
      effectiveHoursRange(range140to180, [{ month: "2026-11", range: { minHours: 140 }, note: "" }], "2026-11"),
    ).toEqual({ minHours: 140 });
  });

  it("同じ月の上書きが 2 つあれば受け付けない", () => {
    expect(() =>
      effectiveHoursRange(
        range140to180,
        [
          { month: "2026-11", range: { maxHours: 180 }, note: "" },
          { month: "2026-11", range: { maxHours: 200 }, note: "" },
        ],
        "2026-11",
      ),
    ).toThrow("duplicate hours range override");
  });

  it("通常の契約は目安時間なしにできるが、上書きには下限か上限が必要", () => {
    expect(effectiveHoursRange({}, [], "2026-11")).toEqual({});
    expect(() => effectiveHoursRange({}, [{ month: "2026-11", range: {}, note: "" }], "2026-11"))
      .toThrow("Override range must have minHours or maxHours");
    expect(effectiveHoursRange({}, [{ month: "2026-11", range: { maxHours: 0 }, note: "" }], "2026-11"))
      .toEqual({ maxHours: 0 });
  });
});

describe("hoursRangeWarnings: 着地見込み(実績 + 予測)と目安時間を比べて警告を出す", () => {
  const check = (actualHours: number, forecastHours: number, range: HoursRange = range140to180) =>
    hoursRangeWarnings({ actualSeconds: actualHours * HOUR, forecastSeconds: forecastHours * HOUR, range });

  it("範囲内(着地見込み 160h)なら警告なし", () => {
    expect(check(100, 60)).toEqual([]);
  });

  it("下限割れの見込み: 着地見込み 120h、下限 140h → 20h 不足", () => {
    expect(check(80, 40)).toEqual([{ kind: "belowMinForecast", seconds: 20 * HOUR }]);
  });

  it("上限超えの見込み: 着地見込み 195h、上限 180h → 15h 超過", () => {
    expect(check(150, 45)).toEqual([{ kind: "aboveMaxForecast", seconds: 15 * HOUR }]);
  });

  it("実績がすでに上限超え: 実績 182h → 2h 超過(見込みの警告は重ねて出さない)", () => {
    expect(check(182, 10)).toEqual([{ kind: "aboveMaxActual", seconds: 2 * HOUR }]);
  });

  it("ちょうど下限・上限は範囲内", () => {
    expect(check(140, 0)).toEqual([]);
    expect(check(100, 80)).toEqual([]);
  });

  it("目安時間の設定がなければ警告なし", () => {
    expect(check(300, 100, {})).toEqual([]);
  });

  it("下限だけの設定: 着地見込み 130h、下限 140h → 10h 不足", () => {
    expect(check(100, 30, { minHours: 140 })).toEqual([{ kind: "belowMinForecast", seconds: 10 * HOUR }]);
  });

  it("上限だけの設定: 着地見込み 190h、上限 180h → 10h 超過", () => {
    expect(check(100, 90, { maxHours: 180 })).toEqual([{ kind: "aboveMaxForecast", seconds: 10 * HOUR }]);
  });

  it("月の上書きと組み合わせる: 12 月だけ上限 200h、着地見込み 195h → 警告なし", () => {
    const range = effectiveHoursRange(
      range140to180,
      [{ month: "2026-12", range: { minHours: 140, maxHours: 200 }, note: "" }],
      "2026-12",
    );
    expect(check(150, 45, range)).toEqual([]);
  });

  it("分単位の差も秒で正確に出す: 着地見込み 139h59m、下限 140h → 60 秒不足", () => {
    expect(
      hoursRangeWarnings({ actualSeconds: 139 * HOUR + 59 * 60, forecastSeconds: 0, range: { minHours: 140 } }),
    ).toEqual([{ kind: "belowMinForecast", seconds: 60 }]);
  });

  it.each([
    { minHours: -1 },
    { maxHours: Number.NaN },
    { minHours: 180, maxHours: 140 },
  ] as HoursRange[])("不正な目安時間 %o は受け付けない", (range) => {
    expect(() => check(100, 0, range)).toThrow(RangeError);
  });

  it("下限・上限は 0.5h など小数も使える: 下限 140.5h、着地見込み 140h → 30 分不足", () => {
    expect(check(140, 0, { minHours: 140.5 })).toEqual([{ kind: "belowMinForecast", seconds: 30 * 60 }]);
  });

  it("秒数が負なら受け付けない", () => {
    expect(() => hoursRangeWarnings({ actualSeconds: -1, forecastSeconds: 0, range: {} })).toThrow(RangeError);
  });
});
