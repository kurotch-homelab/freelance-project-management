// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client.ts";
import { createApiClient } from "./api-client.ts";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { TestProviders } from "./test-providers.tsx";

// 案件ごとの目安時間(契約の編集)と、月ごとの目安時間の上書き(契約ごと)
afterEach(() => cleanup());

const clientA = {
  id: "client-a",
  name: "A 社",
  archived: false,
  paymentTerms: { closingDay: "end" as const, paymentMonthOffset: 1, paymentDay: "end" as const },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project" as const,
  driveFolderId: null,
};
const projectX = { id: "X", clientId: "client-a", name: "案件 X", archived: false, hourlyRate: 5_000, driveFolderId: null };
const projectY = { id: "Y", clientId: "client-a", name: "案件 Y", archived: false, hourlyRate: 5_000, driveFolderId: null };
const contract1 = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["X", "Y"],
  hoursRange: { minHours: 140, maxHours: 180 },
  projectHoursRanges: { X: { maxHours: 80 } },
  renewalOutlook: "undecided" as const,
};
const overrideWhole = { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "年末" };
const overrideX = { contractId: "c1", projectId: "X", month: "2027-01", range: { minHours: 10, maxHours: 90 }, note: "" };

const fakeApi = (over: Partial<ApiClient> = {}): ApiClient =>
  ({
    listClients: vi.fn(async () => [clientA]),
    listProjects: vi.fn(async () => [projectX, projectY]),
    listContracts: vi.fn(async () => [contract1]),
    saveContract: vi.fn(async () => undefined),
    listHoursRangeOverrides: vi.fn(async () => [overrideWhole, overrideX]),
    saveHoursRangeOverride: vi.fn(async () => undefined),
    deleteHoursRangeOverride: vi.fn(async () => undefined),
    ...over,
  }) as unknown as ApiClient;

const renderPage = (api: ApiClient) => render(<TestProviders><ContractsPage api={api} newId={() => "new-1"} /></TestProviders>);

describe("ContractsPage: 案件ごとの目安時間", () => {
  it("選んだ案件ごとに下限・上限の欄があり、今の値が入っている", async () => {
    const user = userEvent.setup();
    renderPage(fakeApi());
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    expect(screen.getByLabelText("案件 X の月の下限(時間)")).toHaveValue(null);
    expect(screen.getByLabelText("案件 X の月の上限(時間)")).toHaveValue(80);
    expect(screen.getByLabelText("案件 Y の月の上限(時間)")).toHaveValue(null);
  });

  it("変えた値を projectHoursRanges で送る。両方空の案件は送らない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(api);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.type(screen.getByLabelText("案件 X の月の下限(時間)"), "10");
    await user.type(screen.getByLabelText("案件 Y の月の上限(時間)"), "20.5");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).toHaveBeenCalledWith({
      ...contract1,
      projectHoursRanges: { X: { minHours: 10, maxHours: 80 }, Y: { maxHours: 20.5 } },
    });
  });

  it("全部の案件の欄を空にしたら projectHoursRanges を送らない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(api);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.clear(screen.getByLabelText("案件 X の月の上限(時間)"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(vi.mocked(api.saveContract).mock.calls[0]![0]).not.toHaveProperty("projectHoursRanges");
  });

  it("案件を契約から外すと、その案件の目安時間も消して保存できる", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(api);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.click(screen.getByRole("checkbox", { name: "案件 X" }));
    expect(screen.queryByLabelText("案件 X の月の上限(時間)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    const saved = vi.mocked(api.saveContract).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(saved.projectIds).toEqual(["Y"]);
    expect(saved).not.toHaveProperty("projectHoursRanges");
  });

  it("下限が上限より大きければ保存せず、欄のそばにエラーを出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(api);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.type(screen.getByLabelText("案件 X の月の下限(時間)"), "100");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).not.toHaveBeenCalled();
    expect(screen.getByLabelText("案件 X の月の下限(時間)")).toHaveAccessibleDescription(/上限以下/);
  });
});

describe("ContractsPage: 月ごとの目安時間の上書き", () => {
  const open = async (api: ApiClient) => {
    const user = userEvent.setup();
    renderPage(api);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 の月ごとの目安時間" }));
    const region = await screen.findByRole("region", { name: "業務委託契約 の月ごとの目安時間" });
    return { user, region };
  };

  it("契約の上書きを一覧に出す(対象月・対象・下限・上限・メモ)", async () => {
    const api = fakeApi();
    const { region } = await open(api);
    expect(api.listHoursRangeOverrides).toHaveBeenCalledWith({ contractId: "c1" });
    const table = within(region).getByRole("table", { name: "月ごとの目安時間" });
    const dec = within(table).getByRole("row", { name: /2026-12/ });
    expect(dec).toHaveTextContent("契約全体");
    expect(dec).toHaveTextContent("200 時間");
    expect(dec).toHaveTextContent("年末");
    const jan = within(table).getByRole("row", { name: /2027-01/ });
    expect(jan).toHaveTextContent("案件 X");
    expect(jan).toHaveTextContent("10 時間");
    expect(jan).toHaveTextContent("90 時間");
  });

  it("追加: 入力した上書きを保存し、一覧を読み直す", async () => {
    const api = fakeApi();
    const { user, region } = await open(api);
    await user.type(within(region).getByLabelText("対象月"), "2027-02");
    await user.selectOptions(within(region).getByLabelText("対象"), "Y");
    await user.type(within(region).getByLabelText("下限(時間)"), "30");
    await user.type(within(region).getByLabelText("メモ"), "合意済み");
    await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
    expect(api.saveHoursRangeOverride).toHaveBeenCalledWith({
      contractId: "c1",
      projectId: "Y",
      month: "2027-02",
      range: { minHours: 30 },
      note: "合意済み",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
    expect(api.listHoursRangeOverrides).toHaveBeenCalledTimes(2);
  });

  it("対象を選ばなければ契約全体(projectId は null)", async () => {
    const api = fakeApi();
    const { user, region } = await open(api);
    await user.type(within(region).getByLabelText("対象月"), "2027-02");
    await user.type(within(region).getByLabelText("上限(時間)"), "150");
    await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
    expect(api.saveHoursRangeOverride).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, range: { maxHours: 150 }, note: "" }));
  });

  it("下限も上限も空、または対象月の形が違えば保存しない", async () => {
    const api = fakeApi();
    const { user, region } = await open(api);
    await user.type(within(region).getByLabelText("対象月"), "2027-2");
    await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
    expect(api.saveHoursRangeOverride).not.toHaveBeenCalled();
    expect(within(region).getByLabelText("対象月")).toHaveAccessibleDescription(/YYYY-MM/);
    expect(within(region).getByLabelText("下限(時間)")).toHaveAccessibleDescription(/下限か上限を入力してください/);
  });

  it("消す: 行ごとのボタンで消し、一覧を読み直す", async () => {
    const api = fakeApi();
    const { user, region } = await open(api);
    await user.click(within(region).getByRole("button", { name: "2026-12 契約全体 の上書きを消す" }));
    expect(api.deleteHoursRangeOverride).toHaveBeenCalledWith({ contractId: "c1", projectId: null, month: "2026-12" });
    await user.click(within(region).getByRole("button", { name: "2027-01 案件 X の上書きを消す" }));
    expect(api.deleteHoursRangeOverride).toHaveBeenLastCalledWith({ contractId: "c1", projectId: "X", month: "2027-01" });
    expect(api.listHoursRangeOverrides).toHaveBeenCalledTimes(3);
  });

  it("サーバーが断ったら、その理由を出して入力を残す", async () => {
    const api = fakeApi({ saveHoursRangeOverride: vi.fn().mockRejectedValue(new Error("project is not in the contract")) });
    const { user, region } = await open(api);
    await user.type(within(region).getByLabelText("対象月"), "2027-02");
    await user.type(within(region).getByLabelText("上限(時間)"), "150");
    await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("project is not in the contract");
    expect(within(region).getByLabelText("対象月")).toHaveValue("2027-02");
  });
});

describe("api-client: 月ごとの目安時間の上書き", () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }));

  it("listHoursRangeOverrides: GET ?contractId=", async () => {
    const fetch = ok();
    await createApiClient({ fetch }).listHoursRangeOverrides({ contractId: "c 1" });
    expect(fetch).toHaveBeenCalledWith("/api/hours-range-overrides?contractId=c+1", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("saveHoursRangeOverride: POST に JSON", async () => {
    const fetch = ok();
    await createApiClient({ fetch }).saveHoursRangeOverride(overrideWhole);
    expect(fetch).toHaveBeenCalledWith(
      "/api/hours-range-overrides",
      expect.objectContaining({ method: "POST", body: JSON.stringify(overrideWhole) }),
    );
  });

  it("deleteHoursRangeOverride: DELETE にクエリ(projectId は案件の上書きのときだけ)", async () => {
    const fetch = ok();
    const client = createApiClient({ fetch });
    await client.deleteHoursRangeOverride({ contractId: "c1", projectId: null, month: "2026-12" });
    expect(fetch).toHaveBeenLastCalledWith("/api/hours-range-overrides?contractId=c1&month=2026-12", expect.objectContaining({ method: "DELETE" }));
    await client.deleteHoursRangeOverride({ contractId: "c1", projectId: "X", month: "2027-01" });
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/hours-range-overrides?contractId=c1&projectId=X&month=2027-01",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
