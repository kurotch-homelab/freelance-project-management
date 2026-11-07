// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, Contract, HoursRangeOverrideRecord } from "./api-client.ts";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { TestProviders } from "./test-providers.tsx";

afterEach(cleanup);
const contract: Contract = {
  id: "c1", clientId: "a", name: "契約", start: "2026-01-01", end: null,
  projectIds: ["X", "Y"], projectHoursRanges: { X: { maxHours: 80 } }, renewalOutlook: "undecided",
};
const whole: HoursRangeOverrideRecord = { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "合意" };
const project = { ...whole, projectId: "X", range: { minHours: 10 } };
function service(): ApiClient {
  return {
    listContracts: vi.fn(async () => [contract]),
    listClients: vi.fn(async () => [{ id: "a", name: "A 社" }]),
    listProjects: vi.fn(async () => ["X", "Y"].map((id) => ({ id, clientId: "a", name: `案件 ${id}`, archived: false }))),
    listHoursRangeOverrides: vi.fn(async () => [whole, project]),
    saveHoursRangeOverride: vi.fn(async () => undefined),
    deleteHoursRangeOverride: vi.fn(async () => undefined),
    saveContract: vi.fn(async () => undefined),
  } as unknown as ApiClient;
}
async function open(api: ApiClient) {
  const user = userEvent.setup();
  render(<TestProviders><ContractsPage api={api} /></TestProviders>);
  const opener = await screen.findByRole("button", { name: "契約 の月ごとの目安時間" });
  opener.focus();
  await user.keyboard("{Enter}");
  const region = screen.getByRole("region", { name: "契約 の月ごとの目安時間" });
  await within(region).findByRole("table");
  return { user, opener, region };
}

it("キーボードで開閉でき、閉じたら開いたボタンへフォーカスが戻る", async () => {
  const { user, opener, region } = await open(service());
  expect(within(region).getByRole("heading", { name: "契約 の月ごとの目安時間" })).toHaveFocus();
  await user.tab();
  expect(within(region).getByRole("button", { name: "閉じる" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("消した行を再取得で除去し、成功を知らせて対象月へフォーカスを移す", async () => {
  const api = service();
  vi.mocked(api.listHoursRangeOverrides).mockResolvedValueOnce([whole, project]).mockResolvedValueOnce([project]);
  const { user, region } = await open(api);
  await user.click(within(region).getByRole("button", { name: "2026-12 契約全体 の上書きを消す" }));
  expect(await screen.findByRole("status")).toHaveTextContent("消しました");
  expect(within(region).queryByRole("button", { name: "2026-12 契約全体 の上書きを消す" })).not.toBeInTheDocument();
  expect(within(region).getByRole("button", { name: "2026-12 案件 X の上書きを消す" })).toBeInTheDocument();
  expect(within(region).getByLabelText("対象月")).toHaveFocus();
});

it("削除に失敗したら行と追加入力を保持し、理由を表示する", async () => {
  const api = service();
  vi.mocked(api.deleteHoursRangeOverride).mockRejectedValue(new Error("削除を再試行してください"));
  const { user, region } = await open(api);
  await user.type(within(region).getByLabelText("メモ"), "入力中");
  await user.click(within(region).getByRole("button", { name: "2026-12 契約全体 の上書きを消す" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("削除を再試行してください");
  expect(within(region).getByLabelText("メモ")).toHaveValue("入力中");
  expect(within(region).getByRole("button", { name: "2026-12 契約全体 の上書きを消す" })).toHaveFocus();
  expect(api.listHoursRangeOverrides).toHaveBeenCalledTimes(1);
});

it("保存後の再取得に失敗したら成功通知を出さず、入力を残して再読み込みできる", async () => {
  const api = service();
  vi.mocked(api.listHoursRangeOverrides).mockResolvedValueOnce([whole]).mockRejectedValueOnce(new Error("接続エラー")).mockResolvedValueOnce([whole, project]);
  const { user, region } = await open(api);
  await user.type(within(region).getByLabelText("対象月"), "2027-02");
  await user.type(within(region).getByLabelText("上限(時間)"), "20.5");
  await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("接続エラー");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(within(region).getByLabelText("対象月")).toHaveValue("2027-02");
  expect(within(region).getByLabelText("上限(時間)")).toHaveValue(20.5);
  await user.click(within(region).getByRole("button", { name: "再読み込み" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(within(region).getByRole("button", { name: "2026-12 案件 X の上書きを消す" })).toBeInTheDocument();
});

it("上書きの上下限逆転を欄に関連付けて拒否し、修正後は 0 と小数を保存する", async () => {
  const api = service();
  const { user, region } = await open(api);
  await user.type(within(region).getByLabelText("対象月"), "2027-02");
  const min = within(region).getByLabelText("下限(時間)");
  await user.type(min, "30");
  await user.type(within(region).getByLabelText("上限(時間)"), "20.5");
  await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
  expect(api.saveHoursRangeOverride).not.toHaveBeenCalled();
  expect(min).toHaveAccessibleDescription(/上限以下/);
  expect(min).toHaveFocus();
  await user.clear(min);
  await user.type(min, "0");
  await user.click(within(region).getByRole("button", { name: "上書きを追加" }));
  expect(api.saveHoursRangeOverride).toHaveBeenCalledWith({ contractId: "c1", projectId: null, month: "2027-02", range: { minHours: 0, maxHours: 20.5 }, note: "" });
});

it("案件を外して再選択しても、削除した目安時間は復活しない", async () => {
  const api = service();
  const user = userEvent.setup();
  render(<TestProviders><ContractsPage api={api} /></TestProviders>);
  await user.click(await screen.findByRole("button", { name: "契約 を編集" }));
  const checkbox = screen.getByRole("checkbox", { name: "案件 X" });
  await user.click(checkbox);
  await user.click(checkbox);
  expect(screen.getByLabelText("案件 X の月の上限(時間)")).toHaveValue(null);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(vi.mocked(api.saveContract).mock.calls[0]![0]).not.toHaveProperty("projectHoursRanges");
});
