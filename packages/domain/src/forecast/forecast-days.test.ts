import { describe, expect, it } from "vitest";
import type { DailyWork } from "./weekday-average.ts";
import { forecastDays, type ForecastInput, type ForecastProject } from "./forecast-days.ts";

const HOUR = 3_600;

// asOf = 2026-11-08(日)。予測するのは翌日 11/09(月)から until まで。
const asOf = "2026-11-08";
const NEXT_MON = "2026-11-09";

/** asOf より前の直近 8 週の月曜すべてに seconds の記録を作る */
const mondays = (seconds: number): DailyWork[] =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    date: new Date(Date.UTC(2026, 10, 9 - 7 * n)).toISOString().slice(0, 10),
    seconds,
  }));

const project = (over: Partial<ForecastProject> & Pick<ForecastProject, "projectId">): ForecastProject => ({
  clientId: "client-a",
  contract: { start: "2026-01-01", end: null },
  history: [],
  ...over,
});

const input = (over: Partial<ForecastInput>): ForecastInput => ({
  asOf,
  until: NEXT_MON,
  weeks: 8,
  projects: [],
  absenceSeconds: {},
  ...over,
});

/** 結果から (date, projectId) の秒数を取り出す。行がなければ undefined */
const at = (rows: ReturnType<typeof forecastDays>, date: string, projectId: string) =>
  rows.find((r) => r.date === date && r.projectId === projectId);

describe("forecastDays: 案件ごと・日ごとの稼働予測", () => {
  it("案件の実績の曜日別平均を使う: 月曜 4h", () => {
    const rows = forecastDays(input({ projects: [project({ projectId: "A", history: mondays(4 * HOUR) })] }));
    expect(at(rows, NEXT_MON, "A")).toEqual({
      date: NEXT_MON,
      projectId: "A",
      seconds: 4 * HOUR,
      source: "project",
    });
  });

  it("予測するのは asOf の翌日から until まで(両端を含む)", () => {
    const rows = forecastDays(
      input({ until: "2026-11-15", projects: [project({ projectId: "A", history: mondays(4 * HOUR) })] }),
    );
    expect(rows.map((r) => r.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("祝日も区別しない: 勤労感謝の日(11/23 月)も月曜の平均 4h", () => {
    const rows = forecastDays(
      input({ until: "2026-11-23", projects: [project({ projectId: "A", history: mondays(4 * HOUR) })] }),
    );
    expect(at(rows, "2026-11-23", "A")?.seconds).toBe(4 * HOUR);
  });

  describe("Out of Office", () => {
    const a8 = project({ projectId: "A", history: mondays(8 * HOUR) });

    it("1 日すべて不在なら 0h", () => {
      const rows = forecastDays(input({ projects: [a8], absenceSeconds: { [NEXT_MON]: 24 * HOUR } }));
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(0);
    });

    it("予測 8h で 4h 不在なら 4h", () => {
      const rows = forecastDays(input({ projects: [a8], absenceSeconds: { [NEXT_MON]: 4 * HOUR } }));
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(4 * HOUR);
    });

    it("不在が予測より長ければ 0h(マイナスにしない)", () => {
      const a3 = project({ projectId: "A", history: mondays(3 * HOUR) });
      const rows = forecastDays(input({ projects: [a3], absenceSeconds: { [NEXT_MON]: 5 * HOUR } }));
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(0);
    });

    it("2 案件は予測の比率で按分する: A 6h・B 2h、4h 不在 → A 3h・B 1h", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(6 * HOUR) }),
            project({ projectId: "B", clientId: "client-b", history: mondays(2 * HOUR) }),
          ],
          absenceSeconds: { [NEXT_MON]: 4 * HOUR },
        }),
      );
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(3 * HOUR);
      expect(at(rows, NEXT_MON, "B")?.seconds).toBe(1 * HOUR);
    });

    it("不在のない日は減らさない", () => {
      const rows = forecastDays(
        input({ until: "2026-11-16", projects: [a8], absenceSeconds: { [NEXT_MON]: 8 * HOUR } }),
      );
      expect(at(rows, "2026-11-16", "A")?.seconds).toBe(8 * HOUR);
    });
  });

  describe("予測のもとの選び方", () => {
    it("案件の実績がなければ、同じ取引先の全案件の実績を使う", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", contract: { start: "2026-01-01", end: "2026-10-31" }, history: mondays(4 * HOUR) }),
            project({ projectId: "B", contract: { start: "2026-11-01", end: null } }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "B")).toMatchObject({ seconds: 4 * HOUR, source: "client" });
    });

    it("初めての取引先なら、自分の稼働の空き(全案件の平均 − ほかの案件の予測)を使う", () => {
      // 全案件の月曜平均 = A 5h + Old 3h = 8h。Old は契約が終わっているので予測は 0。
      // 空き = 8h − A の予測 5h = 3h
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(5 * HOUR) }),
            project({
              projectId: "Old",
              clientId: "client-old",
              contract: { start: "2026-01-01", end: "2026-10-31" },
              history: mondays(3 * HOUR),
            }),
            project({ projectId: "N", clientId: "client-new", contract: { start: "2026-11-01", end: null } }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "N")).toMatchObject({ seconds: 3 * HOUR, source: "capacity" });
    });

    it("空きがなければ 0h", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(8 * HOUR) }),
            project({ projectId: "N", clientId: "client-new" }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "N")).toMatchObject({ seconds: 0, source: "capacity" });
    });

    it("空きを使う案件が複数あれば等分する", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "Old", clientId: "client-old", contract: { start: "2026-01-01", end: "2026-10-31" }, history: mondays(6 * HOUR) }),
            project({ projectId: "N1", clientId: "client-n1" }),
            project({ projectId: "N2", clientId: "client-n2" }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "N1")?.seconds).toBe(3 * HOUR);
      expect(at(rows, NEXT_MON, "N2")?.seconds).toBe(3 * HOUR);
    });

    it("どこにも実績がなければ、その案件の行は出さない", () => {
      const rows = forecastDays(input({ projects: [project({ projectId: "N" })] }));
      expect(rows).toEqual([]);
    });
  });

  describe("契約期間", () => {
    it("契約終了日の翌日からは 0h(行を出さない)", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-16",
          projects: [project({ projectId: "A", contract: { start: "2026-01-01", end: "2026-11-09" }, history: mondays(4 * HOUR) })],
        }),
      );
      expect(at(rows, "2026-11-09", "A")?.seconds).toBe(4 * HOUR);
      expect(at(rows, "2026-11-16", "A")).toBeUndefined();
    });

    it("契約開始日より前は行を出さない", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-16",
          projects: [project({ projectId: "A", contract: { start: "2026-11-10", end: null }, history: mondays(4 * HOUR) })],
        }),
      );
      expect(at(rows, "2026-11-09", "A")).toBeUndefined();
      expect(at(rows, "2026-11-16", "A")?.seconds).toBe(4 * HOUR);
    });
  });

  describe("入力チェック", () => {
    it("until が asOf より前なら受け付けない", () => {
      expect(() => forecastDays(input({ until: "2026-11-01" }))).toThrow(RangeError);
    });

    it("until が asOf と同じなら空", () => {
      expect(forecastDays(input({ until: asOf, projects: [project({ projectId: "A", history: mondays(HOUR) })] }))).toEqual([]);
    });

    it("不在秒数が負なら受け付けない", () => {
      expect(() => forecastDays(input({ absenceSeconds: { [NEXT_MON]: -1 } }))).toThrow(RangeError);
    });

    it("同じ projectId が 2 つあれば受け付けない", () => {
      expect(() =>
        forecastDays(input({ projects: [project({ projectId: "A" }), project({ projectId: "A" })] })),
      ).toThrow(RangeError);
    });
  });
});
