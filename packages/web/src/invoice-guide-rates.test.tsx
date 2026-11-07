// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client.ts";
import { InvoiceGuidePage } from "./pages/InvoiceGuidePage.tsx";
import { TestProviders } from "./test-providers.tsx";

afterEach(() => cleanup());

describe("InvoiceGuidePage: 品目名が同じ行", () => {
  it("コピーのボタンは行ごとに見分けられる名前にする(単価を添える)", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const api = {
      listClients: vi.fn(async () => [{ id: "client-a", name: "A 社" }]),
      invoiceGuide: vi.fn(async () => ({
        clientName: "A 社",
        subject: "11月分",
        invoiceDate: "2026-11-30",
        dueDate: "2026-12-31",
        lines: [
          { item: "業務委託契約 2026年11月分(案件 X)", quantity: 1, unit: "時間", unitPrice: 5_000, amount: 5_000 },
          { item: "業務委託契約 2026年11月分(案件 X)", quantity: 2, unit: "時間", unitPrice: 6_000, amount: 12_000 },
        ],
        note: null,
        warnings: [],
        subtotal: 17_000,
        tax: 1_700,
        total: 18_700,
      })),
    } as unknown as ApiClient;
    render(<TestProviders><InvoiceGuidePage api={api} defaultMonth="2026-11" /></TestProviders>);
    await user.selectOptions(await screen.findByLabelText("取引先"), "client-a");
    await user.click(await screen.findByRole("button", { name: "業務委託契約 2026年11月分(案件 X)・¥6,000 の数量をコピー" }));
    expect(writeText).toHaveBeenLastCalledWith("2");
    const names = screen.getAllByRole("button", { name: /をコピー$/ }).map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});
