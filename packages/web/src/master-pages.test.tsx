// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client.ts";
import { ClientsPage } from "./pages/ClientsPage.tsx";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { TestProviders } from "./test-providers.tsx";

afterEach(() => cleanup());

const clientA = {
  id: "client-a",
  name: "A 社",
  paymentTerms: { closingDay: "end" as const, paymentMonthOffset: 1, paymentDay: "end" as const },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project" as const,
  solidtimeClientId: "st-a",
  driveFolderId: "folder-a",
};
const clientB = {
  ...clientA,
  id: "client-b",
  name: "B 社",
  paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
  lineGrouping: "contract" as const,
  solidtimeClientId: null,
  driveFolderId: null,
};
const projectX = {
  id: "X", clientId: "client-a", name: "案件 X", status: "active" as const, solidtimeProjectId: "st-x", driveFolderId: "folder-x",
};
const projectY = {
  id: "Y", clientId: "client-a", name: "案件 Y", status: "proposed" as const, solidtimeProjectId: null, driveFolderId: null,
};
const contract1 = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  hourlyRate: 5_000,
  projectIds: ["X"],
  projectRates: {},
  hoursRange: { minHours: 140, maxHours: 180 },
  projectHoursRanges: { X: { maxHours: 80 } },
  renewalOutlook: "undecided" as const,
};

const fakeApi = (over: Partial<ApiClient> = {}): ApiClient =>
  ({
    listClients: vi.fn(async () => [clientA, clientB]),
    listProjects: vi.fn(async () => [projectX, projectY]),
    listContracts: vi.fn(async () => [contract1]),
    saveClient: vi.fn(async () => undefined),
    saveProject: vi.fn(async () => undefined),
    saveContract: vi.fn(async () => ({ ok: true, pushRates: { ok: true, pushed: [], skipped: [] } })),
    ...over,
  }) as unknown as ApiClient;

const newId = () => "new-1";
const renderPage = (ui: React.ReactElement) => render(<TestProviders>{ui}</TestProviders>);

describe("ClientsPage: 取引先", () => {
  it("一覧に名前と支払条件を出す", async () => {
    renderPage(<ClientsPage api={fakeApi()} newId={newId} />);
    const table = await screen.findByRole("table", { name: "取引先" });
    expect(within(table).getByRole("row", { name: /A 社/ })).toHaveTextContent("月末締め 翌月末払い");
    expect(within(table).getByRole("row", { name: /B 社/ })).toHaveTextContent("20日締め 翌々月10日払い");
  });

  it("追加: 入力した内容を保存し、一覧を読み直す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ClientsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "取引先を追加" }));
    await user.type(screen.getByLabelText("名前"), "C 社");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClient).toHaveBeenCalledWith({
      id: "new-1",
      name: "C 社",
      paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
      subjectTemplate: "{YYYY}年{M}月分 業務委託料",
      lineGrouping: "project",
      solidtimeClientId: null,
      driveFolderId: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
    expect(api.listClients).toHaveBeenCalledTimes(2);
  });

  it("編集: 画面にない項目(solidtime や Drive の id)はそのまま残す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ClientsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "A 社 を編集" }));
    expect(screen.getByLabelText("名前")).toHaveValue("A 社");
    await user.selectOptions(screen.getByLabelText("締め日"), "20");
    await user.selectOptions(screen.getByLabelText("明細のまとめ方"), "contract");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClient).toHaveBeenCalledWith({
      ...clientA,
      paymentTerms: { ...clientA.paymentTerms, closingDay: 20 },
      lineGrouping: "contract",
    });
  });

  it("名前が空なら保存せず、欄のそばにエラーを出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ClientsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "取引先を追加" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClient).not.toHaveBeenCalled();
    expect(screen.getByLabelText("名前")).toHaveAccessibleDescription(/名前を入力してください/);
  });

  it("サーバーが断ったら、その理由を出して入力を残す", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ saveClient: vi.fn().mockRejectedValue(new Error("invalid payment terms")) });
    renderPage(<ClientsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "取引先を追加" }));
    await user.type(screen.getByLabelText("名前"), "C 社");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid payment terms");
    expect(screen.getByLabelText("名前")).toHaveValue("C 社");
  });
});

describe("ProjectsPage: 案件", () => {
  it("一覧に取引先の名前、ステータス、solidtime のプロジェクトを出す", async () => {
    renderPage(<ProjectsPage api={fakeApi()} newId={newId} />);
    const table = await screen.findByRole("table", { name: "案件" });
    const x = within(table).getByRole("row", { name: /案件 X/ });
    expect(x).toHaveTextContent("A 社");
    expect(x).toHaveTextContent("稼働中");
    expect(x).toHaveTextContent("st-x");
    expect(within(table).getByRole("row", { name: /案件 Y/ })).toHaveTextContent("提案中");
  });

  it("追加: solidtime のプロジェクト ID は任意(空なら null)", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ProjectsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "案件を追加" }));
    await user.selectOptions(screen.getByLabelText("取引先"), "client-b");
    await user.type(screen.getByLabelText("名前"), "案件 Z");
    await user.selectOptions(screen.getByLabelText("ステータス"), "won");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveProject).toHaveBeenCalledWith({
      id: "new-1", clientId: "client-b", name: "案件 Z", status: "won", solidtimeProjectId: null, driveFolderId: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
  });

  it("編集: solidtime のプロジェクトを結びつける。Drive のフォルダーはそのまま", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ProjectsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "案件 Y を編集" }));
    await user.type(screen.getByLabelText("solidtime のプロジェクト ID"), "st-y");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveProject).toHaveBeenCalledWith({ ...projectY, solidtimeProjectId: "st-y" });
  });
});

describe("ContractsPage: 契約", () => {
  it("一覧に取引先、期間、単価、更新の見込みを出す", async () => {
    renderPage(<ContractsPage api={fakeApi()} newId={newId} />);
    const table = await screen.findByRole("table", { name: "契約" });
    const row = within(table).getByRole("row", { name: /業務委託契約/ });
    expect(row).toHaveTextContent("A 社");
    expect(row).toHaveTextContent("2026-01-01 〜");
    expect(row).toHaveTextContent("¥5,000/時間");
    expect(row).toHaveTextContent("未定");
  });

  it("追加: 取引先の案件から選び、目安時間と更新の見込みも保存する", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    await user.selectOptions(screen.getByLabelText("取引先"), "client-a");
    await user.type(screen.getByLabelText("名前"), "2027 年度の契約");
    await user.type(screen.getByLabelText("開始日"), "2027-01-01");
    await user.type(screen.getByLabelText("時間単価"), "5500");
    await user.click(screen.getByRole("checkbox", { name: "案件 X" }));
    await user.click(screen.getByRole("checkbox", { name: "案件 Y" }));
    await user.type(screen.getByLabelText("案件 Y の単価"), "6000");
    await user.type(screen.getByLabelText("月の下限(時間)"), "140");
    await user.type(screen.getByLabelText("月の上限(時間)"), "180");
    await user.selectOptions(screen.getByLabelText("更新の見込み"), "likely");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).toHaveBeenCalledWith({
      id: "new-1",
      clientId: "client-a",
      name: "2027 年度の契約",
      start: "2027-01-01",
      end: null,
      hourlyRate: 5_500,
      projectIds: ["X", "Y"],
      projectRates: { Y: 6_000 },
      hoursRange: { minHours: 140, maxHours: 180 },
      renewalOutlook: "likely",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました。solidtime に単価を反映しました");
  });

  it("目安時間が両方空なら hoursRange を送らない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    await user.selectOptions(screen.getByLabelText("取引先"), "client-a");
    await user.type(screen.getByLabelText("名前"), "契約");
    await user.type(screen.getByLabelText("開始日"), "2027-01-01");
    await user.type(screen.getByLabelText("時間単価"), "5000");
    await user.click(screen.getByRole("checkbox", { name: "案件 X" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(vi.mocked(api.saveContract).mock.calls[0]![0]).not.toHaveProperty("hoursRange");
  });

  it("取引先を選ぶまで案件は選べず、ほかの取引先の案件は出さない", async () => {
    const user = userEvent.setup();
    renderPage(<ContractsPage api={fakeApi()} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    expect(screen.queryByRole("checkbox", { name: "案件 X" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("取引先"), "client-b");
    expect(screen.queryByRole("checkbox", { name: "案件 X" })).not.toBeInTheDocument();
  });

  it("編集: 画面にない案件ごとの目安時間はそのまま残す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    const rate = screen.getByLabelText("時間単価");
    await user.clear(rate);
    await user.type(rate, "5500");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).toHaveBeenCalledWith({ ...contract1, hourlyRate: 5_500 });
  });

  it("時間単価が正の整数でなければ保存しない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    const rate = screen.getByLabelText("時間単価");
    await user.clear(rate);
    await user.type(rate, "50.5");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).not.toHaveBeenCalled();
    expect(rate).toHaveAccessibleDescription(/1 円以上の整数/);
  });

  it("単価の反映に失敗したら、保存はできたことと失敗の理由を出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      saveContract: vi.fn(async () => ({ ok: true, pushRates: { ok: false, error: "Solidtime request failed (HTTP 500)" } })),
    } as Partial<ApiClient>);
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "契約は保存しました。solidtime への単価の反映に失敗しました: Solidtime request failed (HTTP 500)",
    );
  });

  it("solidtime に結びついていない案件は、単価を反映していないことを知らせる", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      saveContract: vi.fn(async () => ({
        ok: true,
        pushRates: { ok: true, pushed: [{ projectId: "X", hourlyRate: 5_000 }], skipped: [{ projectId: "Y", reason: "noSolidtimeProject" }] },
      })),
    } as Partial<ApiClient>);
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("案件 Y は solidtime のプロジェクトに結びついていないため、単価を反映していません"),
    ).toBeInTheDocument();
  });

  it("契約の期間が重なるなどでサーバーが断ったら、その理由を出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ saveContract: vi.fn().mockRejectedValue(new Error("contracts overlap")) });
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("contracts overlap");
  });
});
