import { describe, expect, it } from "vitest";
import type { Contract } from "./contracts.ts";
import type { ForecastRow } from "./forecast/forecast-days.ts";
import { monthOutlook, type MonthOutlookInput } from "./month-outlook.ts";

const HOUR = 3_600;

// 2026-11 の途中(asOf = 11/15)。実績は 11/15 まで、予測は 11/16 から。
const month = "2026-11";
const asOf = "2026-11-15";

const contract = (over: Partial<Contract> = {}): Contract => ({
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  hourlyRate: 5_000,
  projectIds: ["X", "Y"],
  projectRates: {},
  renewalOutlook: "undecided",
  hoursRange: { minHours: 140, maxHours: 180 },
  projectHoursRanges: {},
  ...over,
});

const row = (projectId: string, date: string, seconds: number, assumesRenewal = false): ForecastRow => ({
  date,
  projectId,
  seconds,
  source: "project",
  assumesRenewal,
});

const outlookFor = (over: Partial<MonthOutlookInput>) =>
  monthOutlook({
    month,
    asOf,
    contracts: [contract()],
    actual: [],
    forecast: [],
    hoursRangeOverrides: [],
    ...over,
  });

describe("monthOutlook: 契約ごとの月の着地見込み", () => {
  it("実績 + 予測 = 着地見込み。請求見込み額と目安時間の判定を出す", () => {
    const [c] = outlookFor({
      actual: [
        { projectId: "X", date: "2026-11-10", seconds: 60 * HOUR },
        { projectId: "Y", date: "2026-11-10", seconds: 20 * HOUR },
      ],
      forecast: [row("X", "2026-11-20", 40 * HOUR), row("Y", "2026-11-20", 20 * HOUR)],
    });
    expect(c).toEqual({
      contractId: "c1",
      contractName: "業務委託契約",
      actualSeconds: 80 * HOUR,
      forecastSeconds: 60 * HOUR,
      landingSeconds: 140 * HOUR,
      assumesRenewal: false,
      estimate: { subtotal: 700_000, tax: 70_000, total: 770_000 },
      warnings: [],
      projects: [
        { projectId: "X", actualSeconds: 60 * HOUR, forecastSeconds: 40 * HOUR, landingSeconds: 100 * HOUR, warnings: [] },
        { projectId: "Y", actualSeconds: 20 * HOUR, forecastSeconds: 20 * HOUR, landingSeconds: 40 * HOUR, warnings: [] },
      ],
    });
  });

  it("目安時間は契約配下の全案件の合計と比べる: 着地見込み 120h、下限 140h → 20h 不足", () => {
    const [c] = outlookFor({
      actual: [{ projectId: "X", date: "2026-11-10", seconds: 80 * HOUR }],
      forecast: [row("Y", "2026-11-20", 40 * HOUR)],
    });
    expect(c?.warnings).toEqual([{ kind: "belowMinForecast", seconds: 20 * HOUR }]);
  });

  it("案件ごとの目安時間も設定できる: Y の上限 30h、Y の着地見込み 40h → Y に 10h 超過の警告", () => {
    const [c] = outlookFor({
      contracts: [contract({ projectHoursRanges: { Y: { maxHours: 30 } } })],
      actual: [{ projectId: "X", date: "2026-11-10", seconds: 110 * HOUR }],
      forecast: [row("Y", "2026-11-20", 40 * HOUR)],
    });
    expect(c?.warnings).toEqual([]);
    expect(c?.projects.find((p) => p.projectId === "Y")?.warnings).toEqual([
      { kind: "aboveMaxForecast", seconds: 10 * HOUR },
    ]);
  });

  it("月の上書きは契約全体にも案件にも使える", () => {
    const [c] = outlookFor({
      contracts: [contract({ projectHoursRanges: { Y: { maxHours: 30 } } })],
      actual: [{ projectId: "X", date: "2026-11-10", seconds: 155 * HOUR }],
      forecast: [row("Y", "2026-11-20", 40 * HOUR)],
      hoursRangeOverrides: [
        { contractId: "c1", projectId: null, month, range: { minHours: 140, maxHours: 200 }, note: "" },
        { contractId: "c1", projectId: "Y", month, range: { maxHours: 50 }, note: "" },
      ],
    });
    expect(c?.warnings).toEqual([]);
    expect(c?.projects.find((p) => p.projectId === "Y")?.warnings).toEqual([]);
  });

  it("予測の小数秒は、案件ごとの月の合計を切り捨ててから使う", () => {
    const [c] = outlookFor({
      contracts: [contract({ hoursRange: {} })],
      forecast: [row("X", "2026-11-20", 0.5), row("X", "2026-11-21", 0.5), row("X", "2026-11-22", 0.5)],
    });
    expect(c?.projects.find((p) => p.projectId === "X")?.forecastSeconds).toBe(1);
    expect(c?.forecastSeconds).toBe(1);
  });

  it("asOf より後の実績と、対象月の外の実績・予測は使わない", () => {
    const [c] = outlookFor({
      contracts: [contract({ hoursRange: {} })],
      actual: [
        { projectId: "X", date: "2026-10-31", seconds: 100 * HOUR },
        { projectId: "X", date: "2026-11-15", seconds: 1 * HOUR },
        { projectId: "X", date: "2026-11-16", seconds: 100 * HOUR },
      ],
      forecast: [row("X", "2026-11-20", 2 * HOUR), row("X", "2026-12-01", 100 * HOUR)],
    });
    expect(c).toMatchObject({ actualSeconds: 1 * HOUR, forecastSeconds: 2 * HOUR });
  });

  it("請求見込み額は案件ごとの単価の上書きを使う: Y だけ 7,000 円", () => {
    const [c] = outlookFor({
      contracts: [contract({ hoursRange: {}, projectRates: { Y: 7_000 } })],
      actual: [
        { projectId: "X", date: "2026-11-10", seconds: 10 * HOUR },
        { projectId: "Y", date: "2026-11-10", seconds: 10 * HOUR },
      ],
    });
    expect(c?.estimate.subtotal).toBe(120_000);
  });

  it("月の途中で更新した契約は、それぞれの契約の期間の分だけを持つ", () => {
    const outlooks = outlookFor({
      contracts: [
        contract({ id: "c1", end: "2026-11-15", hoursRange: {} }),
        contract({ id: "c2", start: "2026-11-16", hourlyRate: 6_000, hoursRange: {} }),
      ],
      actual: [{ projectId: "X", date: "2026-11-10", seconds: 10 * HOUR }],
      forecast: [row("X", "2026-11-20", 5 * HOUR)],
    });
    expect(outlooks.map((o) => [o.contractId, o.landingSeconds, o.estimate.subtotal])).toEqual([
      ["c1", 10 * HOUR, 50_000],
      ["c2", 5 * HOUR, 30_000],
    ]);
  });

  it("更新前提の予測を含む契約には印をつける", () => {
    const [c] = outlookFor({
      contracts: [contract({ end: "2026-11-15", renewalOutlook: "likely", hoursRange: {} })],
      forecast: [row("X", "2026-11-20", 5 * HOUR, true)],
    });
    expect(c).toMatchObject({ contractId: "c1", forecastSeconds: 5 * HOUR, assumesRenewal: true });
  });

  it("更新見込みが「高い」契約は、終了した月より後の月にも更新前提として出す", () => {
    const outlooks = monthOutlook({
      month: "2026-12",
      asOf,
      contracts: [contract({ end: "2026-11-30", renewalOutlook: "likely", hoursRange: {} })],
      actual: [],
      forecast: [row("X", "2026-12-07", 4 * HOUR, true)],
      hoursRangeOverrides: [],
    });
    expect(outlooks).toHaveLength(1);
    expect(outlooks[0]).toMatchObject({ contractId: "c1", forecastSeconds: 4 * HOUR, assumesRenewal: true });
    expect(outlooks[0]?.estimate.subtotal).toBe(20_000);
  });

  it("更新見込みが「高い」契約でも、あとに次の契約があれば、終了後の月には出さない", () => {
    const outlooks = monthOutlook({
      month: "2026-12",
      asOf,
      contracts: [
        contract({ id: "c1", end: "2026-11-30", renewalOutlook: "likely", hoursRange: {} }),
        contract({ id: "c2", start: "2026-12-01", hoursRange: {} }),
      ],
      actual: [],
      forecast: [],
      hoursRangeOverrides: [],
    });
    expect(outlooks.map((o) => o.contractId)).toEqual(["c2"]);
  });

  it.each(["undecided", "ending"] as const)("更新見込みが %s の契約は、終了後の月には出さない", (outlook) => {
    expect(
      monthOutlook({
        month: "2026-12",
        asOf,
        contracts: [contract({ end: "2026-11-30", renewalOutlook: outlook })],
        actual: [],
        forecast: [],
        hoursRangeOverrides: [],
      }),
    ).toEqual([]);
  });

  it("その月に有効な契約は、稼働がなくても出す(下限の不足が分かるように)", () => {
    const [c] = outlookFor({});
    expect(c).toMatchObject({ landingSeconds: 0, warnings: [{ kind: "belowMinForecast", seconds: 140 * HOUR }] });
  });

  it("その月に有効でない契約は出さない", () => {
    expect(outlookFor({ contracts: [contract({ end: "2026-10-31" })] })).toEqual([]);
  });

  it("契約のない日の実績は受け付けない(契約の登録漏れ)", () => {
    expect(() =>
      outlookFor({
        contracts: [contract({ start: "2026-11-11" })],
        actual: [{ projectId: "X", date: "2026-11-10", seconds: HOUR }],
      }),
    ).toThrow(RangeError);
  });

  it("契約のない日の予測は受け付けない(予測と契約の食い違い)", () => {
    expect(() =>
      outlookFor({
        contracts: [contract({ end: "2026-11-15" })],
        forecast: [row("X", "2026-11-20", HOUR)],
      }),
    ).toThrow(RangeError);
  });

  it("上書きの対象の契約がなければ受け付けない", () => {
    expect(() =>
      outlookFor({
        hoursRangeOverrides: [{ contractId: "nope", projectId: null, month, range: {}, note: "" }],
      }),
    ).toThrow(RangeError);
  });
});
