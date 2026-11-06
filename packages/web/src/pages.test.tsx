// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client.ts";
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
  estimate: { subtotal: 90_000, tax: 9_000, total: 99_000 },
  warnings: [{ kind: "belowMinForecast", seconds: 122 * HOUR }],
  projects: [
    { projectId: "X", actualSeconds: 8 * HOUR, forecastSeconds: 10 * HOUR, landingSeconds: 18 * HOUR, warnings: [] },
  ],
};

const dashboard = {
  asOf: "2026-11-15",
  months: [
    { month: "2026-11", contracts: [outlook] },
    {
      month: "2026-12",
      contracts: [
        {
          ...outlook,
          actualSeconds: 0,
          forecastSeconds: 37.25 * HOUR,
          landingSeconds: 37.25 * HOUR,
          assumesRenewal: true,
          warnings: [{ kind: "aboveMaxForecast", seconds: 15 * HOUR }],
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
    expect(row).toHaveTextContent("¥99,000");
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
