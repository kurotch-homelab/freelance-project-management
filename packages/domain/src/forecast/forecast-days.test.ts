import { describe, expect, it } from "vitest";
import type { Contract } from "../contracts.ts";
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
  history: [],
  ...over,
});

const contract = (over: Partial<Contract> & Pick<Contract, "id" | "projectIds">): Contract => ({
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  hourlyRate: 5_000,
  projectRates: {},
  renewalOutlook: "undecided",
  ...over,
});

/** contracts を省略すると、全案件を含む終了日なしの契約を 1 つ置く */
const input = (over: Partial<ForecastInput>): ForecastInput => {
  const projects = over.projects ?? [];
  return {
    asOf,
    until: NEXT_MON,
    weeks: 8,
    absenceSeconds: {},
    contracts: [contract({ id: "default", projectIds: projects.map((p) => p.projectId) })],
    ...over,
    projects,
  };
};

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
      assumesRenewal: false,
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

  it("0 秒の記録は実績なしと同じに扱う", () => {
    const rows = forecastDays(
      input({
        projects: [
          project({ projectId: "A", history: mondays(4 * HOUR) }),
          project({ projectId: "B", history: mondays(0) }),
        ],
      }),
    );
    // B は 0 秒の記録しかないので、同じ取引先の実績(A 4h)から A の予測 4h を引いた残り 0h
    expect(at(rows, NEXT_MON, "B")).toMatchObject({ seconds: 0, source: "client" });
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

    it("空きの等分と不在を同時に: 全体 8h、A 5h、新規 2 件、4h 不在 → A 2.5h・新規 0.75h ずつ", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(5 * HOUR) }),
            project({ projectId: "Old", clientId: "client-old", history: mondays(3 * HOUR) }),
            project({ projectId: "N1", clientId: "client-n1" }),
            project({ projectId: "N2", clientId: "client-n2" }),
          ],
          contracts: [
            contract({ id: "a", projectIds: ["A"] }),
            contract({ id: "old", clientId: "client-old", end: "2026-10-31", projectIds: ["Old"] }),
            contract({ id: "n1", clientId: "client-n1", projectIds: ["N1"] }),
            contract({ id: "n2", clientId: "client-n2", projectIds: ["N2"] }),
          ],
          absenceSeconds: { [NEXT_MON]: 4 * HOUR },
        }),
      );
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(2.5 * HOUR);
      expect(at(rows, NEXT_MON, "N1")?.seconds).toBe(0.75 * HOUR);
      expect(at(rows, NEXT_MON, "N2")?.seconds).toBe(0.75 * HOUR);
    });

    it("不在のない日は減らさない", () => {
      const rows = forecastDays(
        input({ until: "2026-11-16", projects: [a8], absenceSeconds: { [NEXT_MON]: 8 * HOUR } }),
      );
      expect(at(rows, "2026-11-16", "A")?.seconds).toBe(8 * HOUR);
    });
  });

  describe("予測のもとの選び方", () => {
    it("案件の実績がなければ、同じ取引先の実績を使う(終了した案件 A 4h → 新案件 B 4h)", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(4 * HOUR) }),
            project({ projectId: "B" }),
          ],
          contracts: [
            contract({ id: "c1", end: "2026-10-31", projectIds: ["A"] }),
            contract({ id: "c2", start: "2026-11-01", projectIds: ["B"] }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "B")).toMatchObject({ seconds: 4 * HOUR, source: "client" });
    });

    it("取引先の実績は、継続中の案件の予測を引いた残りを使う(A 4h 継続中 → 新案件 B 0h)", () => {
      const rows = forecastDays(
        input({ projects: [project({ projectId: "A", history: mondays(4 * HOUR) }), project({ projectId: "B" })] }),
      );
      expect(at(rows, NEXT_MON, "A")?.seconds).toBe(4 * HOUR);
      expect(at(rows, NEXT_MON, "B")).toMatchObject({ seconds: 0, source: "client" });
    });

    it("取引先の実績を使う新案件が複数なら等分する(終了した A 4h → B・C 2h ずつ)", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(4 * HOUR) }),
            project({ projectId: "B" }),
            project({ projectId: "C" }),
          ],
          contracts: [
            contract({ id: "c1", end: "2026-10-31", projectIds: ["A"] }),
            contract({ id: "c2", start: "2026-11-01", projectIds: ["B", "C"] }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "B")?.seconds).toBe(2 * HOUR);
      expect(at(rows, NEXT_MON, "C")?.seconds).toBe(2 * HOUR);
    });

    it("初めての取引先なら、自分の稼働の空き(全案件の平均 − ほかの案件の予測)を使う", () => {
      // 全案件の月曜平均 = A 5h + Old 3h = 8h。Old は契約が終わっているので予測は 0。空き = 8h − 5h = 3h
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "A", history: mondays(5 * HOUR) }),
            project({ projectId: "Old", clientId: "client-old", history: mondays(3 * HOUR) }),
            project({ projectId: "N", clientId: "client-new" }),
          ],
          contracts: [
            contract({ id: "a", projectIds: ["A"] }),
            contract({ id: "old", clientId: "client-old", end: "2026-10-31", projectIds: ["Old"] }),
            contract({ id: "n", clientId: "client-new", start: "2026-11-01", projectIds: ["N"] }),
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
            project({ projectId: "Old", clientId: "client-old", history: mondays(6 * HOUR) }),
            project({ projectId: "N1", clientId: "client-n1" }),
            project({ projectId: "N2", clientId: "client-n2" }),
          ],
          contracts: [
            contract({ id: "old", clientId: "client-old", end: "2026-10-31", projectIds: ["Old"] }),
            contract({ id: "n", clientId: "client-n1", projectIds: ["N1", "N2"] }),
          ],
        }),
      );
      expect(at(rows, NEXT_MON, "N1")?.seconds).toBe(3 * HOUR);
      expect(at(rows, NEXT_MON, "N2")?.seconds).toBe(3 * HOUR);
    });

    it("どこにも実績がなければ、その案件の行は出さない", () => {
      expect(forecastDays(input({ projects: [project({ projectId: "N" })] }))).toEqual([]);
    });
  });

  describe("契約", () => {
    it("契約終了日の翌日からは行を出さない(更新見込み: 未定)", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-16",
          projects: [project({ projectId: "A", history: mondays(4 * HOUR) })],
          contracts: [contract({ id: "c", end: "2026-11-09", projectIds: ["A"] })],
        }),
      );
      expect(at(rows, "2026-11-09", "A")?.seconds).toBe(4 * HOUR);
      expect(at(rows, "2026-11-16", "A")).toBeUndefined();
    });

    it("更新見込みが「高い」なら、終了日のあとも更新前提の印つきで続ける", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-16",
          projects: [project({ projectId: "A", history: mondays(4 * HOUR) })],
          contracts: [contract({ id: "c", end: "2026-11-09", renewalOutlook: "likely", projectIds: ["A"] })],
        }),
      );
      expect(at(rows, "2026-11-09", "A")).toMatchObject({ seconds: 4 * HOUR, assumesRenewal: false });
      expect(at(rows, "2026-11-16", "A")).toMatchObject({ seconds: 4 * HOUR, assumesRenewal: true });
    });

    it("契約開始日より前は行を出さない", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-16",
          projects: [project({ projectId: "A", history: mondays(4 * HOUR) })],
          contracts: [contract({ id: "c", start: "2026-11-10", projectIds: ["A"] })],
        }),
      );
      expect(at(rows, "2026-11-09", "A")).toBeUndefined();
      expect(at(rows, "2026-11-16", "A")?.seconds).toBe(4 * HOUR);
    });

    it("契約の空白期間は行を出さない", () => {
      const rows = forecastDays(
        input({
          until: "2026-11-23",
          projects: [project({ projectId: "A", history: mondays(4 * HOUR) })],
          contracts: [
            contract({ id: "c1", end: "2026-11-08", renewalOutlook: "likely", projectIds: ["A"] }),
            contract({ id: "c2", start: "2026-11-20", projectIds: ["A"] }),
          ],
        }),
      );
      expect(at(rows, "2026-11-09", "A")).toBeUndefined();
      expect(at(rows, "2026-11-16", "A")).toBeUndefined();
      expect(at(rows, "2026-11-23", "A")?.seconds).toBe(4 * HOUR);
    });

    it("1 つの契約に複数の案件がぶら下がる", () => {
      const rows = forecastDays(
        input({
          projects: [
            project({ projectId: "X", history: mondays(3 * HOUR) }),
            project({ projectId: "Y", history: mondays(2 * HOUR) }),
          ],
          contracts: [contract({ id: "c", projectIds: ["X", "Y"] })],
        }),
      );
      expect(at(rows, NEXT_MON, "X")?.seconds).toBe(3 * HOUR);
      expect(at(rows, NEXT_MON, "Y")?.seconds).toBe(2 * HOUR);
    });

    it("どの契約にも入っていない案件は行を出さない", () => {
      const rows = forecastDays(
        input({
          projects: [project({ projectId: "A", history: mondays(4 * HOUR) })],
          contracts: [contract({ id: "c", projectIds: ["other"] })],
        }),
      );
      expect(rows).toEqual([]);
    });
  });

  describe("入力チェック", () => {
    it("until が asOf より前なら受け付けない", () => {
      expect(() => forecastDays(input({ until: "2026-11-01" }))).toThrow(RangeError);
    });

    it("until が asOf と同じなら空", () => {
      expect(
        forecastDays(input({ until: asOf, projects: [project({ projectId: "A", history: mondays(HOUR) })] })),
      ).toEqual([]);
    });

    it("不在秒数が負なら受け付けない", () => {
      expect(() => forecastDays(input({ absenceSeconds: { [NEXT_MON]: -1 } }))).toThrow(RangeError);
    });

    it("不在の日付が不正なら受け付けない", () => {
      expect(() => forecastDays(input({ absenceSeconds: { "2026-11-31": HOUR } }))).toThrow(RangeError);
    });

    it("同じ projectId が 2 つあれば受け付けない", () => {
      expect(() =>
        forecastDays(input({ projects: [project({ projectId: "A" }), project({ projectId: "A" })] })),
      ).toThrow(RangeError);
    });

    it("契約が不正(同じ案件の期間が重なる)なら受け付けない", () => {
      expect(() =>
        forecastDays(
          input({
            projects: [project({ projectId: "A" })],
            contracts: [contract({ id: "c1", projectIds: ["A"] }), contract({ id: "c2", projectIds: ["A"] })],
          }),
        ),
      ).toThrow(RangeError);
    });
  });
});
