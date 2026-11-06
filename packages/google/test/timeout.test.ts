import { describe, expect, it } from "vitest";
import { createCalendarClient, createDriveClient } from "../src/index.ts";

/** 応答を返さず、中断されたときだけ失敗する fetch */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

const range = { timeMin: "2026-11-01T00:00:00Z", timeMax: "2026-12-01T00:00:00Z" };

describe("Google のリクエストの期限", () => {
  it("応答がなければ timeoutMs で失敗する(同期が止まったままにならない)", async () => {
    const calendar = createCalendarClient({
      getAccessToken: async () => "token",
      calendarId: "me@example.com",
      fetch: hangingFetch,
      timeoutMs: 50,
    });
    const started = Date.now();
    await expect(calendar.listOutOfOffice(range)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("アクセストークンの取得が終わらなくても timeoutMs で失敗する", async () => {
    const drive = createDriveClient({
      getAccessToken: () => new Promise<string>(() => {}),
      driveId: "drive",
      fetch: hangingFetch,
      timeoutMs: 50,
    });
    await expect(drive.listFiles("f")).rejects.toThrow();
  });

  it("期限の失敗のメッセージにトークンを出さない", async () => {
    const calendar = createCalendarClient({
      getAccessToken: async () => "secret-access-token",
      calendarId: "me@example.com",
      fetch: hangingFetch,
      timeoutMs: 20,
    });
    await expect(calendar.listOutOfOffice(range)).rejects.toSatisfy(
      (e: unknown) => !String((e as Error).message).includes("secret-access-token"),
    );
  });
});
