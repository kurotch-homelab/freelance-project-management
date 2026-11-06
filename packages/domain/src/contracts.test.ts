import { describe, expect, it } from "vitest";
import { contractCoverage, validateContracts, type Contract } from "./contracts.ts";

const contract = (over: Partial<Contract> & Pick<Contract, "id">): Contract => ({
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-10-01",
  end: "2026-10-31",
  projectIds: ["X", "Y"],

  renewalOutlook: "undecided",
  ...over,
});

describe("contractCoverage: 案件のある日を含む契約を引く", () => {
  const c1 = contract({ id: "c1" });
  const c2 = contract({ id: "c2", start: "2026-11-01", end: "2026-11-30" });

  it("期間内なら、その契約(更新前提ではない)", () => {
    expect(contractCoverage([c1, c2], "X", "2026-10-15")).toEqual({ contract: c1, assumesRenewal: false });
    expect(contractCoverage([c1, c2], "X", "2026-11-01")).toEqual({ contract: c2, assumesRenewal: false });
  });

  it("開始日と終了日はどちらも期間内", () => {
    expect(contractCoverage([c1], "X", "2026-10-01")?.contract.id).toBe("c1");
    expect(contractCoverage([c1], "X", "2026-10-31")?.contract.id).toBe("c1");
  });

  it("対象の案件に入っていなければ null", () => {
    expect(contractCoverage([c1], "Z", "2026-10-15")).toBeNull();
  });

  it("終了日のない契約はずっと続く", () => {
    expect(contractCoverage([contract({ id: "c", end: null })], "X", "2030-01-01")?.contract.id).toBe("c");
  });

  it("最後の契約の更新見込みが「高い」なら、終了日のあとも更新前提で続く", () => {
    const likely = contract({ id: "c2", start: "2026-11-01", end: "2026-11-30", renewalOutlook: "likely" });
    expect(contractCoverage([c1, likely], "X", "2027-01-15")).toEqual({ contract: likely, assumesRenewal: true });
  });

  it.each(["undecided", "ending"] as const)("最後の契約の更新見込みが %s なら、終了日のあとは null", (outlook) => {
    expect(contractCoverage([contract({ id: "c", renewalOutlook: outlook })], "X", "2026-11-01")).toBeNull();
  });

  it("契約と契約のあいだの空白は null(前の契約の更新見込みが「高い」でも)", () => {
    const first = contract({ id: "c1", renewalOutlook: "likely" });
    const later = contract({ id: "c2", start: "2026-11-16", end: "2026-12-31" });
    expect(contractCoverage([first, later], "X", "2026-11-10")).toBeNull();
  });

  it("最初の契約より前は null", () => {
    expect(contractCoverage([c1], "X", "2026-09-30")).toBeNull();
  });

  it("案件ごとに見る: Y だけが次の契約から外れたら、Y は前の契約で終わり", () => {
    const next = contract({ id: "c2", start: "2026-11-01", end: "2026-11-30", projectIds: ["X"] });
    expect(contractCoverage([c1, next], "X", "2026-11-10")?.contract.id).toBe("c2");
    expect(contractCoverage([c1, next], "Y", "2026-11-10")).toBeNull();
  });
});

describe("validateContracts: 契約の入力チェック", () => {
  it("正しい契約の組はそのまま通す", () => {
    expect(() =>
      validateContracts([contract({ id: "c1" }), contract({ id: "c2", start: "2026-11-01", end: null })]),
    ).not.toThrow();
  });

  it("同じ案件が、期間の重なる 2 つの契約に入っていたら受け付けない", () => {
    expect(() =>
      validateContracts([contract({ id: "c1" }), contract({ id: "c2", start: "2026-10-31", end: "2026-11-30" })]),
    ).toThrow(RangeError);
  });

  it("期間が重なっても、案件が別なら受け付ける", () => {
    expect(() =>
      validateContracts([
        contract({ id: "c1", projectIds: ["X"] }),
        contract({ id: "c2", projectIds: ["Y"] }),
      ]),
    ).not.toThrow();
  });

  it("終了日のない契約のあとに別の契約があれば重なりとみなす", () => {
    expect(() =>
      validateContracts([contract({ id: "c1", end: null }), contract({ id: "c2", start: "2027-01-01", end: null })]),
    ).toThrow(RangeError);
  });

  it("終了日が開始日より前なら受け付けない", () => {
    expect(() => validateContracts([contract({ id: "c", start: "2026-10-31", end: "2026-10-01" })])).toThrow(
      RangeError,
    );
  });

  it("同じ id の契約が 2 つあれば受け付けない", () => {
    expect(() =>
      validateContracts([contract({ id: "c" }), contract({ id: "c", start: "2026-11-01", end: null })]),
    ).toThrow(RangeError);
  });

  it("対象の案件がない契約は受け付けない", () => {
    expect(() => validateContracts([contract({ id: "c", projectIds: [] })])).toThrow(RangeError);
  });
});
