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

// 取引先・案件は solidtime から取り込む。画面で変えるのは取引先の請求の設定と、契約だけ
afterEach(() => cleanup());

const clientA = {
  id: "client-a",
  name: "A 社",
  archived: false,
  paymentTerms: { closingDay: "end" as const, paymentMonthOffset: 1, paymentDay: "end" as const },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project" as const,
  driveFolderId: "folder-a",
};
const clientB = {
  ...clientA,
  id: "client-b",
  name: "B 社",
  paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
  lineGrouping: "contract" as const,
  driveFolderId: null,
};
const projectX = { id: "X", clientId: "client-a", name: "案件 X", archived: false, hourlyRate: 5_000, driveFolderId: "folder-x" };
const projectY = { id: "Y", clientId: "client-a", name: "案件 Y", archived: false, hourlyRate: null, driveFolderId: null };
const projectOld = { id: "OLD", clientId: "client-a", name: "案件 OLD", archived: true, hourlyRate: 4_000, driveFolderId: null };
const contract1 = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["X", "OLD"],
  hoursRange: { minHours: 140, maxHours: 180 },
  projectHoursRanges: { X: { maxHours: 80 } },
  renewalOutlook: "undecided" as const,
};

const fakeApi = (over: Partial<ApiClient> = {}): ApiClient =>
  ({
    listClients: vi.fn(async () => [clientA, clientB]),
    listProjects: vi.fn(async (options?: { includeArchived?: boolean }) =>
      options?.includeArchived ? [projectX, projectY, projectOld] : [projectX, projectY],
    ),
    listContracts: vi.fn(async () => [contract1]),
    saveClientBilling: vi.fn(async () => undefined),
    saveContract: vi.fn(async () => undefined),
    ...over,
  }) as unknown as ApiClient;

const newId = () => "new-1";
const renderPage = (ui: React.ReactElement) => render(<TestProviders>{ui}</TestProviders>);

describe("ClientsPage: 取引先(solidtime から取り込む。請求の設定だけ変える)", () => {
  it("一覧に名前と支払条件を出す。追加のボタンはなく、solidtime で追加することを案内する", async () => {
    renderPage(<ClientsPage api={fakeApi()} />);
    const table = await screen.findByRole("table", { name: "取引先" });
    expect(within(table).getByRole("row", { name: /A 社/ })).toHaveTextContent("月末締め 翌月末払い");
    expect(within(table).getByRole("row", { name: /B 社/ })).toHaveTextContent("20日締め 翌々月10日払い");
    expect(screen.queryByRole("button", { name: /取引先を追加/ })).not.toBeInTheDocument();
    expect(screen.getByText("取引先の追加や名前の変更は solidtime で行います")).toBeInTheDocument();
  });

  it("請求の設定を変えて保存する。名前は変えられない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ClientsPage api={api} />);
    await user.click(await screen.findByRole("button", { name: "A 社 の請求の設定を変える" }));
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("締め日"), "20");
    await user.selectOptions(screen.getByLabelText("明細のまとめ方"), "contract");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClientBilling).toHaveBeenCalledWith("client-a", {
      paymentTerms: { closingDay: 20, paymentMonthOffset: 1, paymentDay: "end" },
      subjectTemplate: "{YYYY}年{M}月分 業務委託料",
      lineGrouping: "contract",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
    expect(api.listClients).toHaveBeenCalledTimes(2);
  });

  it("29〜31 日の締め日・支払日もそのまま開いて保存できる(存在しない日は月末として扱う)", async () => {
    const user = userEvent.setup();
    const clientC = { ...clientA, id: "client-c", name: "C 社", paymentTerms: { closingDay: 31, paymentMonthOffset: 1, paymentDay: 30 } };
    const api = fakeApi({ listClients: vi.fn(async () => [clientC]) });
    renderPage(<ClientsPage api={api} />);
    await user.click(await screen.findByRole("button", { name: "C 社 の請求の設定を変える" }));
    expect(screen.getByLabelText("締め日")).toHaveValue("31");
    expect(screen.getByLabelText("支払日")).toHaveValue("30");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClientBilling).toHaveBeenCalledWith("client-c", {
      paymentTerms: clientC.paymentTerms,
      subjectTemplate: clientC.subjectTemplate,
      lineGrouping: clientC.lineGrouping,
    });
  });

  it("件名のひな形が空なら保存せず、欄のそばにエラーを出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ClientsPage api={api} />);
    await user.click(await screen.findByRole("button", { name: "A 社 の請求の設定を変える" }));
    await user.clear(screen.getByLabelText("件名のひな形"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveClientBilling).not.toHaveBeenCalled();
    expect(screen.getByLabelText("件名のひな形")).toHaveAccessibleDescription(/件名のひな形を入力してください/);
  });

  it("サーバーが断ったら、その理由を出して入力を残す", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ saveClientBilling: vi.fn().mockRejectedValue(new Error("invalid payment terms")) });
    renderPage(<ClientsPage api={api} />);
    await user.click(await screen.findByRole("button", { name: "A 社 の請求の設定を変える" }));
    await user.selectOptions(screen.getByLabelText("締め日"), "20");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid payment terms");
    expect(screen.getByLabelText("締め日")).toHaveValue("20");
  });
});

describe("ProjectsPage: 案件(solidtime から取り込む。見るだけ)", () => {
  it("一覧に取引先と単価を出す。単価がなければ「未設定」", async () => {
    renderPage(<ProjectsPage api={fakeApi()} />);
    const table = await screen.findByRole("table", { name: "案件" });
    const x = within(table).getByRole("row", { name: /案件 X/ });
    expect(x).toHaveTextContent("A 社");
    expect(x).toHaveTextContent("¥5,000/時間");
    expect(within(table).getByRole("row", { name: /案件 Y/ })).toHaveTextContent("未設定");
  });

  it("1/100 円の単価は小数第二位まで出す(丸めない)", async () => {
    const api = fakeApi({ listProjects: vi.fn(async () => [{ ...projectX, hourlyRate: 5_000.25 }]) } as Partial<ApiClient>);
    renderPage(<ProjectsPage api={api} />);
    const table = await screen.findByRole("table", { name: "案件" });
    expect(within(table).getByRole("row", { name: /案件 X/ })).toHaveTextContent("¥5,000.25/時間");
  });

  it("追加・編集のボタンはなく、solidtime で変えることを案内する", async () => {
    renderPage(<ProjectsPage api={fakeApi()} />);
    await screen.findByRole("table", { name: "案件" });
    expect(screen.queryByRole("button", { name: /追加|編集/ })).not.toBeInTheDocument();
    expect(screen.getByText("案件の追加・名前・単価・アーカイブは solidtime で変えます")).toBeInTheDocument();
  });

  it("アーカイブした案件はふだん隠し、切り替えると「アーカイブ」の印つきで出す", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ProjectsPage api={api} />);
    const table = await screen.findByRole("table", { name: "案件" });
    expect(within(table).queryByRole("row", { name: /案件 OLD/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "アーカイブした案件も表示" }));
    const old = await within(screen.getByRole("table", { name: "案件" })).findByRole("row", { name: /案件 OLD/ });
    expect(old).toHaveTextContent("アーカイブ");
    expect(api.listProjects).toHaveBeenLastCalledWith({ includeArchived: true });
  });
});

describe("ContractsPage: 契約(単価は solidtime。契約は案件・期間・目安時間・更新の見込み)", () => {
  it("一覧に取引先、期間、更新の見込みを出す。単価は出さない", async () => {
    renderPage(<ContractsPage api={fakeApi()} newId={newId} />);
    const table = await screen.findByRole("table", { name: "契約" });
    const row = within(table).getByRole("row", { name: /業務委託契約/ });
    expect(row).toHaveTextContent("A 社");
    expect(row).toHaveTextContent("2026-01-01 〜");
    expect(row).toHaveTextContent("未定");
    expect(row).not.toHaveTextContent("¥");
  });

  it("追加: 取引先の案件から選び、目安時間と更新の見込みも保存する。単価の欄はない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    expect(screen.queryByLabelText(/単価/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("取引先"), "client-a");
    await user.type(screen.getByLabelText("名前"), "2027 年度の契約");
    await user.type(screen.getByLabelText("開始日"), "2027-01-01");
    await user.click(screen.getByRole("checkbox", { name: "案件 X" }));
    await user.click(screen.getByRole("checkbox", { name: "案件 Y" }));
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
      projectIds: ["X", "Y"],
      hoursRange: { minHours: 140, maxHours: 180 },
      renewalOutlook: "likely",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
  });

  it("目安時間が両方空なら hoursRange を送らない", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    await user.selectOptions(screen.getByLabelText("取引先"), "client-a");
    await user.type(screen.getByLabelText("名前"), "契約");
    await user.type(screen.getByLabelText("開始日"), "2027-01-01");
    await user.click(screen.getByRole("checkbox", { name: "案件 X" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(vi.mocked(api.saveContract).mock.calls[0]![0]).not.toHaveProperty("hoursRange");
  });

  it("新しい契約では、アーカイブした案件を選べない", async () => {
    const user = userEvent.setup();
    renderPage(<ContractsPage api={fakeApi()} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    await user.selectOptions(screen.getByLabelText("取引先"), "client-a");
    expect(screen.getByRole("checkbox", { name: "案件 X" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /案件 OLD/ })).not.toBeInTheDocument();
  });

  it("取引先を選ぶまで案件は選べず、ほかの取引先の案件は出さない", async () => {
    const user = userEvent.setup();
    renderPage(<ContractsPage api={fakeApi()} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "契約を追加" }));
    expect(screen.queryByRole("checkbox", { name: "案件 X" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("取引先"), "client-b");
    expect(screen.queryByRole("checkbox", { name: "案件 X" })).not.toBeInTheDocument();
  });

  it("編集: すでに入っているアーカイブした案件は印つきで残り、画面にない項目もそのまま送る", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPage(<ContractsPage api={api} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: "業務委託契約 を編集" }));
    expect(screen.getByRole("checkbox", { name: /案件 OLD\(アーカイブ\)/ })).toBeChecked();
    const end = screen.getByLabelText("終了日");
    await user.type(end, "2026-12-31");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api.saveContract).toHaveBeenCalledWith({ ...contract1, end: "2026-12-31" });
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
