import { describe, expect, it } from "vitest";
import type { Contract } from "./contracts.ts";
import { invoiceGuide, type InvoiceGuideInput, type InvoiceGuideProject } from "./invoice-guide.ts";

const HOUR = 3_600;

const client = (over: Partial<InvoiceGuideInput["client"]> = {}): InvoiceGuideInput["client"] => ({
  name: "A 社",
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  lineGrouping: "project",
  ...over,
});

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
  ...over,
});

const X = (work: InvoiceGuideProject["work"]): InvoiceGuideProject => ({ id: "X", name: "案件 X", work });
const Y = (work: InvoiceGuideProject["work"]): InvoiceGuideProject => ({ id: "Y", name: "案件 Y", work });

const guideFor = (over: Partial<InvoiceGuideInput>) =>
  invoiceGuide({ month: "2026-11", client: client(), contracts: [contract()], projects: [], ...over });

describe("invoiceGuide: freee で請求書を作るときに入力する内容を、取引先 × 月ごとに出す", () => {
  it("1 案件: 11 月 37 時間 15 分、5,000 円/h、月末締め翌月末払い", () => {
    expect(guideFor({ projects: [X([{ date: "2026-11-10", seconds: 37 * HOUR + 15 * 60 }])] })).toEqual({
      clientName: "A 社",
      subject: "2026年11月分 業務委託料",
      invoiceDate: "2026-11-30",
      dueDate: "2026-12-31",
      lines: [{ item: "案件 X 2026年11月分", quantity: 37.25, unit: "時間", unitPrice: 5_000, amount: 186_250 }],
      note: null,
      subtotal: 186_250,
      tax: 18_625,
      total: 204_875,
    });
  });

  describe("明細行の分け方: 案件ごと", () => {
    it("同じ契約の 2 案件は 1 枚にまとめ、案件ごとに行を分ける", () => {
      const guide = guideFor({
        projects: [
          X([{ date: "2026-11-10", seconds: 37 * HOUR + 15 * 60 }]),
          Y([{ date: "2026-11-11", seconds: 10 * HOUR }]),
        ],
      });
      expect(guide?.lines.map((l) => [l.item, l.amount])).toEqual([
        ["案件 X 2026年11月分", 186_250],
        ["案件 Y 2026年11月分", 50_000],
      ]);
      expect(guide).toMatchObject({ subtotal: 236_250, tax: 23_625, total: 259_875 });
    });

    it("案件ごとの単価の上書きを使う: Y だけ 7,000 円", () => {
      const guide = guideFor({
        contracts: [contract({ projectRates: { Y: 7_000 } })],
        projects: [X([{ date: "2026-11-10", seconds: HOUR }]), Y([{ date: "2026-11-10", seconds: HOUR }])],
      });
      expect(guide?.lines.map((l) => l.unitPrice)).toEqual([5_000, 7_000]);
    });
  });

  describe("明細行の分け方: 契約ごと", () => {
    it("配下の案件の時間を合算して 1 行にし、内訳を備考に出す", () => {
      const guide = guideFor({
        client: client({ lineGrouping: "contract" }),
        projects: [
          X([{ date: "2026-11-10", seconds: 37 * HOUR + 15 * 60 }]),
          Y([{ date: "2026-11-11", seconds: 10 * HOUR }]),
        ],
      });
      expect(guide?.lines).toEqual([
        { item: "業務委託契約 2026年11月分", quantity: 47.25, unit: "時間", unitPrice: 5_000, amount: 236_250 },
      ]);
      expect(guide?.note).toBe("内訳: 案件 X 37.25 時間、案件 Y 10 時間");
    });

    it("合算してから請求時間にする: X 10 時間 1 分 + Y 10 時間 1 分 = 20 時間 2 分 → 20.03h", () => {
      const guide = guideFor({
        client: client({ lineGrouping: "contract" }),
        projects: [X([{ date: "2026-11-10", seconds: 10 * HOUR + 60 }]), Y([{ date: "2026-11-10", seconds: 10 * HOUR + 60 }])],
      });
      expect(guide?.lines[0]).toMatchObject({ quantity: 20.03, amount: 100_150 });
    });

    it("単価の上書きで単価が違う案件は、案件名を添えて単価ごとに行を分ける", () => {
      const guide = guideFor({
        client: client({ lineGrouping: "contract" }),
        contracts: [contract({ projectRates: { Y: 7_000 } })],
        projects: [X([{ date: "2026-11-10", seconds: 20 * HOUR }]), Y([{ date: "2026-11-10", seconds: 10 * HOUR }])],
      });
      expect(guide?.lines.map((l) => [l.item, l.unitPrice, l.amount])).toEqual([
        ["業務委託契約 2026年11月分(案件 X)", 5_000, 100_000],
        ["業務委託契約 2026年11月分(案件 Y)", 7_000, 70_000],
      ]);
    });
  });

  describe("契約の更新", () => {
    const renewed = [
      contract({ id: "c1", end: "2026-11-15" }),
      contract({ id: "c2", start: "2026-11-16", hourlyRate: 6_000 }),
    ];

    it("月の途中で更新して単価が変わったら、期間を品目名に入れて行を分ける", () => {
      const guide = guideFor({
        contracts: renewed,
        projects: [
          X([
            { date: "2026-11-05", seconds: 12 * HOUR },
            { date: "2026-11-15", seconds: 8 * HOUR },
            { date: "2026-11-20", seconds: 10 * HOUR },
          ]),
        ],
      });
      expect(guide?.lines).toEqual([
        { item: "案件 X 2026年11月分(11/1〜11/15)", quantity: 20, unit: "時間", unitPrice: 5_000, amount: 100_000 },
        { item: "案件 X 2026年11月分(11/16〜11/30)", quantity: 10, unit: "時間", unitPrice: 6_000, amount: 60_000 },
      ]);
    });

    it("更新しても単価が同じなら 1 行のまま", () => {
      const guide = guideFor({
        contracts: [contract({ id: "c1", end: "2026-11-15" }), contract({ id: "c2", start: "2026-11-16" })],
        projects: [X([{ date: "2026-11-05", seconds: 20 * HOUR }, { date: "2026-11-20", seconds: 10 * HOUR }])],
      });
      expect(guide?.lines).toEqual([
        { item: "案件 X 2026年11月分", quantity: 30, unit: "時間", unitPrice: 5_000, amount: 150_000 },
      ]);
    });

    it("更新見込みが「高い」だけで、契約がない日の稼働は請求できない(契約の登録漏れ)", () => {
      expect(() =>
        guideFor({
          contracts: [contract({ end: "2026-11-15", renewalOutlook: "likely" })],
          projects: [X([{ date: "2026-11-20", seconds: HOUR }])],
        }),
      ).toThrow(RangeError);
    });
  });

  it("同じ単価の日の稼働は合算してから請求時間にする(20 秒 + 20 秒 = 40 秒 → 0.01h)", () => {
    const guide = guideFor({ projects: [X([{ date: "2026-11-10", seconds: 20 }, { date: "2026-11-11", seconds: 20 }])] });
    expect(guide?.lines[0]?.quantity).toBe(0.01);
  });

  it("割り切れない時間: 10 時間 1 分 → 数量 10.01、金額 50,050", () => {
    const guide = guideFor({ projects: [X([{ date: "2026-11-10", seconds: 10 * HOUR + 60 }])] });
    expect(guide?.lines[0]).toMatchObject({ quantity: 10.01, amount: 50_050 });
  });

  it("対象月の外の稼働は使わない", () => {
    const guide = guideFor({
      projects: [
        X([
          { date: "2026-10-31", seconds: 100 * HOUR },
          { date: "2026-11-10", seconds: 1 * HOUR },
          { date: "2026-12-01", seconds: 100 * HOUR },
        ]),
      ],
    });
    expect(guide?.lines[0]?.quantity).toBe(1);
  });

  it("稼働ゼロの案件は明細に出さない", () => {
    const guide = guideFor({ projects: [X([{ date: "2026-11-10", seconds: HOUR }]), Y([])] });
    expect(guide?.lines).toHaveLength(1);
  });

  it("全案件の稼働がゼロなら null(請求なし)", () => {
    expect(guideFor({ projects: [X([]), Y([{ date: "2026-11-10", seconds: 0 }])] })).toBeNull();
  });

  it("件名のテンプレートは {YYYY}・{M}・{MM} を置き換える", () => {
    const guide = guideFor({
      month: "2026-03",
      client: client({ subjectTemplate: "{YYYY}/{MM} 開発支援({M}月分)" }),
      projects: [X([{ date: "2026-03-10", seconds: HOUR }])],
    });
    expect(guide?.subject).toBe("2026/03 開発支援(3月分)");
  });

  it("稼働日を含む契約がなければ受け付けない", () => {
    expect(() =>
      guideFor({ contracts: [contract({ start: "2026-11-15" })], projects: [X([{ date: "2026-11-10", seconds: HOUR }])] }),
    ).toThrow(RangeError);
  });

  it("契約が不正(同じ案件の期間が重なる)なら受け付けない", () => {
    expect(() =>
      guideFor({
        contracts: [contract({ id: "c1" }), contract({ id: "c2" })],
        projects: [X([{ date: "2026-11-10", seconds: HOUR }])],
      }),
    ).toThrow(RangeError);
  });
});
