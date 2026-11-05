import { describe, expect, it } from "vitest";
import { weekdayAverages, type DailyWork } from "./weekday-average.ts";

// 2026-11-09 は月曜。asOf(今日)は含めず、その前日までの直近 N 週を見る。
const HOUR = 3_600;
const asOf = "2026-11-09";

// 曜日のインデックスは 0 = 日曜 … 6 = 土曜(Date#getUTCDay と同じ)
const MON = 1;
const SAT = 6;

/** asOf の n 週前の月曜(n = 1 なら 2026-11-02) */
const mondayWeeksAgo = (n: number) => {
  const d = new Date(Date.UTC(2026, 10, 9 - 7 * n));
  return d.toISOString().slice(0, 10);
};

describe("weekdayAverages: 直近 N 週の曜日ごとの平均稼働秒数", () => {
  it("直近 8 週の月曜の合計が 32h なら、月曜の平均は 4h", () => {
    const work: DailyWork[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      date: mondayWeeksAgo(n),
      seconds: 4 * HOUR,
    }));
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[MON]).toBe(4 * HOUR);
  });

  it("稼働した週としていない週が混ざっても、期間内の月曜の回数で割る", () => {
    // 8 週のうち 4 回だけ 8h(最初は 8 週前)→ 合計 32h / 8 回 = 4h
    const work: DailyWork[] = [2, 4, 6, 8].map((n) => ({
      date: mondayWeeksAgo(n),
      seconds: 8 * HOUR,
    }));
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[MON]).toBe(4 * HOUR);
  });

  it("普段働かない曜日(土曜)は 0", () => {
    const work: DailyWork[] = [{ date: mondayWeeksAgo(1), seconds: 8 * HOUR }];
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[SAT]).toBe(0);
  });

  it("実績が N 週に満たないときは、最初の実績の日からの回数で割る", () => {
    // 最初の実績が 2 週前の月曜。月曜は 5h と 3h → 2 回で割って 4h
    const work: DailyWork[] = [
      { date: mondayWeeksAgo(2), seconds: 5 * HOUR },
      { date: mondayWeeksAgo(1), seconds: 3 * HOUR },
    ];
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[MON]).toBe(4 * HOUR);
  });

  it("最初の実績より前の曜日は回数に数えない(水曜に始めた案件の月曜)", () => {
    // 2026-10-28(水)に開始、月曜は 11/2 の 1 回だけで 6h
    const work: DailyWork[] = [
      { date: "2026-10-28", seconds: 2 * HOUR },
      { date: "2026-11-02", seconds: 6 * HOUR },
    ];
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[MON]).toBe(6 * HOUR);
  });

  it("N 週より前と今日以降の実績は合計に入れない", () => {
    const work: DailyWork[] = [
      { date: mondayWeeksAgo(9), seconds: 100 * HOUR }, // 期間より前
      { date: mondayWeeksAgo(1), seconds: 8 * HOUR },
      { date: asOf, seconds: 100 * HOUR }, // 今日
      { date: "2026-11-16", seconds: 100 * HOUR }, // 未来
    ];
    // 期間より前に実績がある = 期間の最初から続いている案件なので、月曜 8 回で割る
    expect(weekdayAverages(work, { asOf, weeks: 8 })?.[MON]).toBe(1 * HOUR);
  });

  it("同じ日に複数の記録があれば合計する", () => {
    const work: DailyWork[] = [
      { date: mondayWeeksAgo(1), seconds: 3 * HOUR },
      { date: mondayWeeksAgo(1), seconds: 1 * HOUR },
    ];
    expect(weekdayAverages(work, { asOf, weeks: 1 })?.[MON]).toBe(4 * HOUR);
  });

  it("実績がまったくなければ null(予測のもとにできない)", () => {
    expect(weekdayAverages([], { asOf, weeks: 8 })).toBeNull();
  });

  it("期間より前の実績しかなければ(休眠中の案件)、すべて 0", () => {
    expect(
      weekdayAverages([{ date: mondayWeeksAgo(20), seconds: 8 * HOUR }], { asOf, weeks: 8 }),
    ).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("今日以降の実績しかなければ null", () => {
    expect(weekdayAverages([{ date: asOf, seconds: 8 * HOUR }], { asOf, weeks: 8 })).toBeNull();
  });

  it("戻り値は日曜から土曜までの 7 要素", () => {
    const result = weekdayAverages([{ date: mondayWeeksAgo(1), seconds: HOUR }], {
      asOf,
      weeks: 8,
    });
    expect(result).toHaveLength(7);
  });

  it.each([0, -1, 1.5, Number.NaN])("weeks %d は受け付けない", (weeks) => {
    expect(() => weekdayAverages([], { asOf, weeks })).toThrow(RangeError);
  });

  it.each(["2026-11-31", "2026/11/09", ""])("asOf %s は受け付けない", (bad) => {
    expect(() => weekdayAverages([], { asOf: bad, weeks: 8 })).toThrow(RangeError);
  });

  it("秒数が負や非整数の記録は受け付けない", () => {
    expect(() =>
      weekdayAverages([{ date: mondayWeeksAgo(1), seconds: -1 }], { asOf, weeks: 8 }),
    ).toThrow(RangeError);
  });
});
