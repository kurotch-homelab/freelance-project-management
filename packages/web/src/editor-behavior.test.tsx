// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, Client, Contract } from "./api-client.ts";
import { ClientsPage } from "./pages/ClientsPage.tsx";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { TestProviders } from "./test-providers.tsx";

afterEach(cleanup);
const client: Client = {
  id: "a", name: "A 社", archived: false, driveFolderId: null, lineGrouping: "project",
  subjectTemplate: "{M}月分", paymentTerms: { closingDay: 31, paymentDay: 30, paymentMonthOffset: 1 },
};
const api = (): ApiClient => ({
  listClients: vi.fn(async () => [client]), saveClientBilling: vi.fn(async () => undefined),
} as unknown as ApiClient);

it.each([false, true])("再取得完了までフォームを保持し、外に移したフォーカスは戻さない: %s", async (moveFocus) => {
  const user = userEvent.setup();
  const service = api();
  let resolveReload!: (clients: readonly Client[]) => void;
  const reloaded = new Promise<readonly Client[]>((resolve) => { resolveReload = resolve; });
  vi.mocked(service.listClients).mockResolvedValueOnce([client]).mockReturnValueOnce(reloaded);
  render(<TestProviders><button>別の操作</button><ClientsPage api={service} /></TestProviders>);
  const opener = await screen.findByRole("button", { name: "A 社 の請求の設定を変える" });
  await user.click(opener);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(service.listClients).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByLabelText("締め日")).toHaveValue("31");
  const elsewhere = screen.getByRole("button", { name: "別の操作" });
  if (moveFocus) await user.click(elsewhere);
  await act(async () => resolveReload([client]));
  await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
  expect(moveFocus ? elsewhere : opener).toHaveFocus();
  expect(service.saveClientBilling).toHaveBeenCalledTimes(1);
});

it("既存契約のアーカイブ案件を括弧付きで表示し、編集後も保持する", async () => {
  const user = userEvent.setup();
  const contract: Contract = { id: "c", clientId: "a", name: "契約", start: "2026-01-01", end: null, projectIds: ["old"], renewalOutlook: "undecided" };
  const service = {
    ...api(),
    listProjects: vi.fn(async () => [{ id: "old", clientId: "a", name: "旧案件", archived: true, hourlyRate: 5000, driveFolderId: null }]),
    listContracts: vi.fn(async () => [contract]), saveContract: vi.fn(async () => undefined),
  };
  render(<TestProviders><ContractsPage api={service} /></TestProviders>);
  await user.click(await screen.findByRole("button", { name: "契約 を編集" }));
  expect(screen.getByRole("checkbox", { name: "旧案件(アーカイブ)" })).toBeChecked();
  await user.type(screen.getByLabelText("終了日"), "2026-12-31");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(service.saveContract).toHaveBeenCalledWith({ ...contract, end: "2026-12-31" });
});

it.each([false, true])("取引先が変わった案件を印つきで保持・解除できる(解除: %s)", async (remove) => {
  const user = userEvent.setup();
  const contract: Contract = {
    id: "c", clientId: "a", name: "契約", start: "2026-01-01", end: null,
    projectIds: ["moved", "stay"], projectHoursRanges: { moved: { maxHours: 80 }, stay: { minHours: 10 } }, renewalOutlook: "undecided",
  };
  const service = {
    ...api(),
    listProjects: vi.fn(async () => [
      { id: "moved", clientId: "b", name: "移動案件", archived: true, hourlyRate: 5000, driveFolderId: null },
      { id: "stay", clientId: "a", name: "継続案件", archived: false, hourlyRate: 5000, driveFolderId: null },
      { id: "other", clientId: "b", name: "別案件", archived: false, hourlyRate: 5000, driveFolderId: null },
    ]),
    listContracts: vi.fn(async () => [contract]), saveContract: vi.fn(async () => undefined),
  };
  render(<TestProviders><ContractsPage api={service} /></TestProviders>);
  await user.click(await screen.findByRole("button", { name: "契約 を編集" }));
  const moved = screen.getByRole("checkbox", { name: "移動案件(取引先が変わりました)" });
  expect(moved).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "別案件" })).not.toBeInTheDocument();
  if (remove) await user.click(moved);
  await user.type(screen.getByLabelText("終了日"), "2026-12-31");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(service.saveContract).toHaveBeenCalledWith({
    ...contract, end: "2026-12-31",
    ...(remove ? { projectIds: ["stay"], projectHoursRanges: { stay: { minHours: 10 } } } : {}),
  });
});

it.each(["payment", "subject"])("請求設定が不正なら送信せず入力を保持する: %s", async (field) => {
  const user = userEvent.setup();
  const service = api();
  render(<TestProviders><ClientsPage api={service} /></TestProviders>);
  await user.click(await screen.findByRole("button", { name: "A 社 の請求の設定を変える" }));
  if (field === "payment") await user.selectOptions(screen.getByLabelText("支払月"), "0");
  else {
    await user.clear(screen.getByLabelText("件名のひな形"));
    await user.type(screen.getByLabelText("件名のひな形"), "   ");
  }
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(service.saveClientBilling).not.toHaveBeenCalled();
  expect(screen.getByRole("form")).toBeInTheDocument();
  expect(screen.getByText(field === "payment" ? "当月払いの支払日は締め日以降を選択してください" : "件名のひな形を入力してください")).toBeInTheDocument();
});
