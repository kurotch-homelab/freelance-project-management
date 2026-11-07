import { describe, expect, it } from "vitest";
import type { Contract } from "./contracts.ts";
import { invoiceGuide, type InvoiceGuideInput, type InvoiceGuideProject } from "./invoice-guide.ts";

// 稼働の単価が同じ場合の明細行の分け方(docs/requirements.md 3 章「請求書の作成ガイド」)
const HOUR = 3_600;

const client = (lineGrouping: "project" | "contract"): InvoiceGuideInput["client"] => ({
  id: "client-a",
  name: "A 社",
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  lineGrouping,
});

/** 11/15 で契約 1 が終わり、11/16 から契約 2(更新) */
const renewed = (name2: string): Contract[] => [
  { id: "c1", clientId: "client-a", name: "業務委託契約", start: "2026-01-01", end: "2026-11-15", projectIds: ["X"], renewalOutlook: "likely" },
  { id: "c2", clientId: "client-a", name: name2, start: "2026-11-16", end: null, projectIds: ["X"], renewalOutlook: "undecided" },
];

const X: InvoiceGuideProject = {
  id: "X",
  clientId: "client-a",
  name: "案件 X",
  hourlyRate: 5_000,
  work: [
    { date: "2026-11-10", seconds: 20 * HOUR, hourlyRate: 5000 },
    { date: "2026-11-20", seconds: 10 * HOUR, hourlyRate: 5000 },
  ],
};

const guide = (lineGrouping: "project" | "contract", contracts: Contract[]) =>
  invoiceGuide({ month: "2026-11", client: client(lineGrouping), contracts, projects: [X] });

describe("invoiceGuide: 月の途中で契約を更新したときの明細行", () => {
  it("案件ごと: 稼働の単価が同じなら、契約が変わっても 1 行(期間は品目名に入れない)", () => {
    expect(guide("project", renewed("業務委託契約"))?.lines).toEqual([
      { item: "案件 X 2026年11月分", quantity: 30, unit: "時間", unitPrice: 5_000, amount: 150_000 },
    ]);
  });

  it("契約ごと: 名前の違う契約は、それぞれの名前の行にする", () => {
    expect(guide("contract", renewed("2026 年度後期の契約"))?.lines.map((l) => [l.item, l.quantity])).toEqual([
      ["業務委託契約 2026年11月分", 20],
      ["2026 年度後期の契約 2026年11月分", 10],
    ]);
  });

  it("契約ごと: 同じ名前の契約が月に 2 つあるときだけ、期間を品目名に入れて分ける", () => {
    expect(guide("contract", renewed("業務委託契約"))?.lines.map((l) => [l.item, l.quantity])).toEqual([
      ["業務委託契約 2026年11月分(11/1〜11/15)", 20],
      ["業務委託契約 2026年11月分(11/16〜11/30)", 10],
    ]);
  });
});

it.each(["project", "contract"] as const)("%s 単位でも打刻の単価ごとに行を分け、案件の単価を使わない", (lineGrouping) => {
  const result = invoiceGuide({ month: "2026-11", client: client(lineGrouping), contracts: renewed("業務委託契約"), projects: [{
    ...X, hourlyRate: 9999,
    work: [
      { date: "2026-11-10", seconds: 36060, hourlyRate: 4850.25 },
      { date: "2026-11-10", seconds: 36060, hourlyRate: 6000.25 },
      { date: "2026-11-11", seconds: 3600, hourlyRate: null },
      { date: "2026-11-11", seconds: 3600, hourlyRate: 0 },
    ],
  }] });
  expect(result?.lines.map((l) => [l.quantity, l.unitPrice, l.amount])).toEqual([
    [10.01, 4850.25, 48551], [10.01, 6000.25, 60062], [1, 0, 0],
  ]);
  expect(result).toMatchObject({ subtotal: 108613, tax: 10861, total: 119474,
    warnings: [{ kind: "missingRate", projectId: "X", projectName: "案件 X", seconds: 3600 }],
  });
});
