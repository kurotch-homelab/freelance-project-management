// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Dashboard } from "./api-client.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { InvoiceGuidePage } from "./pages/InvoiceGuidePage.tsx";
import { TestProviders } from "./test-providers.tsx";

const HOUR = 3_600;

afterEach(() => cleanup());

const outlook = {
  contractId: "c1",
  contractName: "業務委託契約",
  actualSeconds: 8 * HOUR,
  forecastSeconds: 10 * HOUR,
  landingSeconds: 18 * HOUR,
  assumesRenewal: false,
  estimate: { subtotal: 90_000 },
  warnings: [{ kind: "belowMinForecast" as const, seconds: 122 * HOUR }],
  projects: [
    { projectId: "X", actualSeconds: 8 * HOUR, forecastSeconds: 10 * HOUR, landingSeconds: 18 * HOUR, warnings: [] },
  ],
};

const dashboard: Dashboard = {
  asOf: "2026-11-15",
  projectNames: { X: "案件 X" },
  projectsWithoutClient: [],
  projectsWithoutRate: [],
  contractProjectMismatches: [],
  workWithoutContract: [],
  unlinked: [] as { solidtimeProjectId: string | null; seconds: number }[],
  months: [
    { month: "2026-11", contracts: [outlook], clients: [{ clientId: "client-a", clientName: "A 社", estimate: { subtotal: 90_000, tax: 9_000, total: 99_000 } }] },
    {
      month: "2026-12",
      clients: [],
      contracts: [
        {
          ...outlook,
          actualSeconds: 0,
          forecastSeconds: 37.25 * HOUR,
          landingSeconds: 37.25 * HOUR,
          assumesRenewal: true,
          warnings: [{ kind: "aboveMaxForecast" as const, seconds: 15 * HOUR }],
        },
      ],
    },
  ],
  sync: {
    solidtime: { lastSuccessAt: "2026-11-15T03:00:00Z", lastFailure: null },
    calendar: { lastSuccessAt: null, lastFailure: { at: "2026-11-15T02:00:00Z", error: "Google API request failed (HTTP 403)" } },
  },
};

const fakeApi = (over: Partial<ApiClient> = {}): ApiClient =>
  ({
    dashboard: vi.fn(async () => dashboard),
    sync: vi.fn(async () => ({ kind: "ok" as const })),
    listClients: vi.fn(async () => [
      { id: "client-a", name: "A 社" },
      { id: "client-b", name: "B 社" },
    ]),
    invoiceGuide: vi.fn(async () => ({
      clientName: "A 社",
      subject: "2026年11月分 業務委託料",
      invoiceDate: "2026-11-30",
      dueDate: "2026-12-31",
      lines: [{ item: "案件 X 2026年11月分", quantity: 37.25, unit: "時間", unitPrice: 5_000, amount: 186_250 }],
      warnings: [],
      note: null,
      subtotal: 186_250,
      tax: 18_625,
      total: 204_875,
    })),
    ...over,
  }) as unknown as ApiClient;

const renderPage = (ui: React.ReactElement) => render(<TestProviders>{ui}</TestProviders>);

describe("DashboardPage", () => {
  it("月ごとに、契約の実績・予測・着地見込み・請求見込み額を出す", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    const nov = await screen.findByRole("region", { name: "2026年11月" });
    const row = within(nov).getByRole("row", { name: /業務委託契約/ });
    expect(row).toHaveTextContent("8 時間");
    expect(row).toHaveTextContent("10 時間");
    expect(row).toHaveTextContent("18 時間");
    expect(row).toHaveTextContent("¥90,000");
    expect(within(nov).getByRole("columnheader", { name: "請求見込み(税抜)" })).toBeInTheDocument();
    const clients = within(nov).getByRole("table", { name: "取引先別の請求見込み(税込)" });
    expect(within(clients).getByRole("row", { name: /A 社/ })).toHaveTextContent("¥99,000");
  });

  it("小数の時間は小数第二位まで出す", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    const dec = await screen.findByRole("region", { name: "2026年12月" });
    expect(within(dec).getByRole("row", { name: /業務委託契約/ })).toHaveTextContent("37.25 時間");
  });

  it("目安時間の警告を、色だけでなく文で出す", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    expect(await screen.findByText("下限まで 122 時間 不足の見込み")).toBeInTheDocument();
    expect(screen.getByText("上限を 15 時間 超える見込み")).toBeInTheDocument();
  });

  it("更新前提の見込みには印をつける", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    const dec = await screen.findByRole("region", { name: "2026年12月" });
    expect(within(dec).getByText("更新前提")).toBeInTheDocument();
    const nov = screen.getByRole("region", { name: "2026年11月" });
    expect(within(nov).queryByText("更新前提")).not.toBeInTheDocument();
  });

  it("同期の状態を出す(失敗はメッセージつき)", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    expect(await screen.findByText(/Google API request failed \(HTTP 403\)/)).toBeInTheDocument();
  });

  it("「solidtime を同期」で同期し、終わったら見込みを読み直す", async () => {
    const api = fakeApi();
    renderPage(<DashboardPage api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "solidtime を同期" }));
    expect(api.sync).toHaveBeenCalledWith("solidtime");
    expect(await screen.findByRole("status")).toHaveTextContent("solidtime を同期しました");
    expect(api.dashboard).toHaveBeenCalledTimes(2);
  });

  it("同期が実行中(busy)なら、そう知らせる", async () => {
    const api = fakeApi({ sync: vi.fn(async () => ({ kind: "busy" as const })) });
    renderPage(<DashboardPage api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "カレンダーを同期" }));
    expect(await screen.findByRole("status")).toHaveTextContent("同期中です。しばらくしてからもう一度お試しください");
  });

  it("同期に失敗したらエラーを出す", async () => {
    const api = fakeApi({ sync: vi.fn(async () => ({ kind: "failed" as const, error: "Solidtime request failed (HTTP 500)" })) });
    renderPage(<DashboardPage api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "solidtime を同期" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Solidtime request failed (HTTP 500)");
  });

  it("読み込みに失敗したらエラーと再読み込みのボタンを出す", async () => {
    const api = fakeApi({ dashboard: vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(dashboard) });
    renderPage(<DashboardPage api={api} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("見込みを読み込めませんでした");
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByRole("region", { name: "2026年11月" })).toBeInTheDocument();
  });
});

describe("DashboardPage: レビューを受けて足した振る舞い", () => {
  it("案件に結びついていない solidtime の稼働を、請求に入らないことと一緒に知らせる", async () => {
    const api = fakeApi({
      dashboard: vi.fn(async () => ({
        ...dashboard,
        unlinked: [
          { solidtimeProjectId: "st-z", seconds: 10 * HOUR },
          { solidtimeProjectId: null, seconds: 1.5 * HOUR },
        ],
      })),
    });
    renderPage(<DashboardPage api={api} />);
    expect(await screen.findByText("案件に結びついていない solidtime の稼働があります(請求に入りません)")).toBeInTheDocument();
    expect(screen.getByText("st-z: 10 時間")).toBeInTheDocument();
    expect(screen.getByText("プロジェクトなし: 1.5 時間")).toBeInTheDocument();
  });

  it("結びついていない稼働がなければ、その知らせは出さない", async () => {
    renderPage(<DashboardPage api={fakeApi()} />);
    await screen.findByRole("region", { name: "2026年11月" });
    expect(screen.queryByText(/案件に結びついていない/)).not.toBeInTheDocument();
  });

  it("案件ごとの目安時間の警告も、案件の名前つきで出す", async () => {
    const api = fakeApi({
      dashboard: vi.fn(async () => ({
        ...dashboard,
        months: [
          {
            month: "2026-11",
            clients: [],
            contracts: [
              {
                ...outlook,
                warnings: [],
                projects: [{ ...outlook.projects[0]!, warnings: [{ kind: "aboveMaxActual" as const, seconds: HOUR }] }],
              },
            ],
          },
        ],
      })),
    });
    renderPage(<DashboardPage api={api} />);
    expect(await screen.findByText("案件 X: 上限を 1 時間 超過")).toBeInTheDocument();
  });

  it("0.01 時間に満たない差の警告は「0.01 時間未満」と出す(0 時間とは出さない)", async () => {
    const api = fakeApi({
      dashboard: vi.fn(async () => ({
        ...dashboard,
        months: [{ month: "2026-11", clients: [], contracts: [{ ...outlook, warnings: [{ kind: "aboveMaxActual" as const, seconds: 30 }] }] }],
      })),
    });
    renderPage(<DashboardPage api={api} />);
    expect(await screen.findByText("上限を 0.01 時間未満 超過")).toBeInTheDocument();
  });

  it("最後の失敗が最終成功より新しければ「未更新」と出す。成功のほうが新しければ出さない", async () => {
    const api = fakeApi({
      dashboard: vi.fn(async () => ({
        ...dashboard,
        sync: {
          solidtime: {
            lastSuccessAt: "2026-11-15T03:00:00Z",
            lastFailure: { at: "2026-11-14T03:00:00Z", error: "Solidtime request failed (HTTP 500)" },
          },
          calendar: {
            lastSuccessAt: "2026-11-14T02:00:00Z",
            lastFailure: { at: "2026-11-15T02:00:00Z", error: "Google API request failed (HTTP 403)" },
          },
        },
      })),
    });
    renderPage(<DashboardPage api={api} />);
    expect(await screen.findByText("カレンダー未更新(前回取り込んだ内容で見込みを出しています)")).toBeInTheDocument();
    expect(screen.queryByText(/solidtime 未更新/)).not.toBeInTheDocument();
  });

  it("同期のあと、読み直した内容に表示が変わる", async () => {
    const api = fakeApi({
      dashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboard)
        .mockResolvedValue({
          ...dashboard,
          months: [{ month: "2026-11", clients: [], contracts: [{ ...outlook, landingSeconds: 20 * HOUR }] }],
        }),
    });
    renderPage(<DashboardPage api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "solidtime を同期" }));
    await screen.findByRole("status");
    const nov = screen.getByRole("region", { name: "2026年11月" });
    expect(await within(nov).findByText("20 時間")).toBeInTheDocument();
  });
});

describe("InvoiceGuidePage: レビューを受けて足した振る舞い", () => {
  it("取引先を続けて切り替えたとき、あとから届いた古い応答で表示を上書きしない", async () => {
    let releaseA: () => void = () => {};
    const guideFor = (subject: string) => ({
      clientName: subject,
      subject,
      invoiceDate: "2026-11-30",
      dueDate: "2026-12-31",
      lines: [],
      warnings: [],
      note: null,
      subtotal: 0,
      tax: 0,
      total: 0,
    });
    const invoiceGuide = vi.fn(({ clientId }: { clientId: string }) =>
      clientId === "client-a"
        ? new Promise((resolve) => (releaseA = () => resolve(guideFor("A の件名"))))
        : Promise.resolve(guideFor("B の件名")),
    );
    renderPage(<InvoiceGuidePage api={fakeApi({ invoiceGuide } as Partial<ApiClient>)} defaultMonth="2026-11" />);
    const select = await screen.findByLabelText("取引先");
    await userEvent.selectOptions(select, "client-a");
    await userEvent.selectOptions(select, "client-b");
    expect(await screen.findByText("B の件名")).toBeInTheDocument();
    releaseA();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("A の件名")).not.toBeInTheDocument();
    expect(screen.getByText("B の件名")).toBeInTheDocument();
  });

  it("金額はカンマなしの数字でコピーする", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage(<InvoiceGuidePage api={fakeApi()} defaultMonth="2026-11" />);
    await user.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    await user.click(await screen.findByRole("button", { name: "案件 X 2026年11月分 の金額をコピー" }));
    expect(writeText).toHaveBeenLastCalledWith("186250");
  });

  it("コピーに失敗したらエラーを出す", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    renderPage(<InvoiceGuidePage api={fakeApi()} defaultMonth="2026-11" />);
    await user.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    await user.click(await screen.findByRole("button", { name: "件名をコピー" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("コピーできませんでした");
  });
});

describe("InvoiceGuidePage", () => {
  it("取引先と月を選ぶと、freee に入力する内容を出す", async () => {
    const api = fakeApi();
    renderPage(<InvoiceGuidePage api={api} defaultMonth="2026-11" />);
    await userEvent.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    expect(api.invoiceGuide).toHaveBeenLastCalledWith({ clientId: "client-a", month: "2026-11" });
    expect(await screen.findByText("2026年11月分 業務委託料")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "明細" });
    const line = within(table).getByRole("row", { name: /案件 X 2026年11月分/ });
    expect(line).toHaveTextContent("37.25");
    expect(line).toHaveTextContent("¥5,000");
    expect(line).toHaveTextContent("¥186,250");
    expect(screen.getByText("2026-11-30")).toBeInTheDocument();
    expect(screen.getByText("2026-12-31")).toBeInTheDocument();
    expect(screen.getByText("¥204,875")).toBeInTheDocument();
  });

  it("各項目をコピーできる", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage(<InvoiceGuidePage api={fakeApi()} defaultMonth="2026-11" />);
    await user.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    await user.click(await screen.findByRole("button", { name: "件名をコピー" }));
    expect(writeText).toHaveBeenLastCalledWith("2026年11月分 業務委託料");
    await user.click(screen.getByRole("button", { name: "案件 X 2026年11月分 の数量をコピー" }));
    expect(writeText).toHaveBeenLastCalledWith("37.25");
    expect(await screen.findByRole("status")).toHaveTextContent("コピーしました");
  });

  it("請求がない月は「請求なし」", async () => {
    const api = fakeApi({ invoiceGuide: vi.fn(async () => null) });
    renderPage(<InvoiceGuidePage api={api} defaultMonth="2026-11" />);
    await userEvent.selectOptions(await screen.findByLabelText("取引先"), "client-b");
    expect(await screen.findByText("この月の請求はありません")).toBeInTheDocument();
  });

  it("月を変えると読み直す", async () => {
    const api = fakeApi();
    renderPage(<InvoiceGuidePage api={api} defaultMonth="2026-11" />);
    await userEvent.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    const month = screen.getByLabelText("対象月");
    await userEvent.clear(month);
    await userEvent.type(month, "2026-10");
    expect(api.invoiceGuide).toHaveBeenLastCalledWith({ clientId: "client-a", month: "2026-10" });
  });
});

it("取引先なし・単価なしの案件を名前と対処方法つきで知らせる", async () => {
  renderPage(<DashboardPage api={fakeApi({ dashboard: vi.fn(async () => ({
    ...dashboard, projectsWithoutClient: [{ id: "X", name: "案件 X" }], projectsWithoutRate: [{ id: "Y", name: "案件 Y" }],
  })) })} />);
  expect(await screen.findByText(/案件 X は取引先が未設定/)).toHaveTextContent("solidtime で取引先を設定");
  expect(screen.getByText(/案件 Y の単価を確認してください/)).toHaveTextContent("請求見込み額に含めていません");
});

it("請求明細が全件単価なしでも、除外した時間と警告を表示する", async () => {
  const user = userEvent.setup();
  renderPage(<InvoiceGuidePage defaultMonth="2026-11" api={fakeApi({ invoiceGuide: vi.fn(async () => ({
    clientName: "A 社", subject: "11月分", invoiceDate: "2026-11-30", dueDate: "2026-12-31",
    lines: [], subtotal: 0, tax: 0, total: 0, note: null,
    warnings: [{ kind: "missingRate" as const, projectId: "Y", projectName: "案件 Y", seconds: 3 * HOUR }],
  })) })} />);
  await user.selectOptions(await screen.findByLabelText("取引先"), "client-a");
  expect(await screen.findByText("案件 Y の稼働のうち、単価が未設定の 3 時間 を請求に入れていません")).toBeInTheDocument();
  expect(screen.getByText("請求に含められる明細はありません")).toBeInTheDocument();
});

it("取引先変更と契約なし稼働をダッシュボードに表示する", async () => {
  renderPage(<DashboardPage api={fakeApi({ dashboard: vi.fn(async () => ({
    ...dashboard,
    contractProjectMismatches: [{ contractId: "c1", contractName: "業務委託契約", projectId: "X", projectName: "案件 X", projectClientId: null }],
    workWithoutContract: [{ projectId: "X", name: "案件 X", seconds: 3600 }],
  })) })} />);
  expect(await screen.findByText(/案件 X\(取引先が変わりました\)/)).toBeInTheDocument();
  expect(screen.getByText("契約に入っていない稼働があります")).toBeInTheDocument();
  expect(screen.getByText("案件 X: 1 時間")).toBeInTheDocument();
});

it("請求書ガイドの小数単価と契約なし稼働の警告を表示する", async () => {
  const service = fakeApi();
  const original = await service.invoiceGuide({ clientId: "client-a", month: "2026-11" });
  vi.mocked(service.invoiceGuide).mockResolvedValue({
    ...original!,
    lines: [{ item: "案件 X 2026年11月分", quantity: 1, unit: "時間", unitPrice: 5000.25, amount: 5000 }],
    warnings: [{ kind: "missingContract", projectId: "X", projectName: "案件 X", seconds: 3600 }],
    subtotal: 5000, tax: 500, total: 5500,
  });
  renderPage(<InvoiceGuidePage api={service} defaultMonth="2026-11" />);
  await userEvent.selectOptions(await screen.findByLabelText("取引先"), "client-a");
  expect(await screen.findByText("¥5,000.25")).toBeInTheDocument();
  expect(screen.getByText("案件 X: 契約に入っていない稼働 1 時間")).toBeInTheDocument();
  expect(screen.queryByText(/単価が未設定/)).not.toBeInTheDocument();
});
