import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCalendarClient, createDriveClient, GoogleApiError, GoogleAuthError } from "../src/index.ts";

// レスポンスの形は Google Calendar API v3 / Drive API v3 のリファレンスに合わせている
const CAL = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const getAccessToken = async () => "access-token";

describe("Calendar: Out of Office の予定を取る", () => {
  const calendar = () => createCalendarClient({ getAccessToken, calendarId: "me@example.com" });

  it("eventTypes=outOfOffice・singleEvents=true と期間を付けて取る", async () => {
    let url: URL | undefined;
    let auth: string | null = null;
    server.use(
      http.get(`${CAL}/calendars/:calendarId/events`, ({ request, params }) => {
        url = new URL(request.url);
        auth = request.headers.get("authorization");
        expect(params.calendarId).toBe("me@example.com");
        return HttpResponse.json({ items: [] });
      }),
    );
    await calendar().listOutOfOffice({ timeMin: "2026-11-01T00:00:00+09:00", timeMax: "2026-12-01T00:00:00+09:00" });
    expect(url?.searchParams.get("eventTypes")).toBe("outOfOffice");
    expect(url?.searchParams.get("singleEvents")).toBe("true");
    expect(url?.searchParams.get("timeMin")).toBe("2026-11-01T00:00:00+09:00");
    expect(url?.searchParams.get("timeMax")).toBe("2026-12-01T00:00:00+09:00");
    expect(auth).toBe("Bearer access-token");
  });

  it("nextPageToken をたどって全件取る。キャンセルされた予定と Out of Office 以外は除く", async () => {
    server.use(
      http.get(`${CAL}/calendars/:calendarId/events`, ({ request }) => {
        const pageToken = new URL(request.url).searchParams.get("pageToken");
        if (!pageToken) {
          return HttpResponse.json({
            items: [
              {
                id: "e1",
                status: "confirmed",
                eventType: "outOfOffice",
                start: { dateTime: "2026-11-09T13:00:00+09:00" },
                end: { dateTime: "2026-11-09T18:00:00+09:00" },
              },
              {
                id: "e2",
                status: "cancelled",
                eventType: "outOfOffice",
                start: { dateTime: "2026-11-10T13:00:00+09:00" },
                end: { dateTime: "2026-11-10T18:00:00+09:00" },
              },
            ],
            nextPageToken: "p2",
          });
        }
        expect(pageToken).toBe("p2");
        return HttpResponse.json({
          items: [
            {
              id: "e3",
              status: "confirmed",
              eventType: "default",
              start: { dateTime: "2026-11-11T13:00:00+09:00" },
              end: { dateTime: "2026-11-11T14:00:00+09:00" },
            },
            {
              id: "e4",
              status: "confirmed",
              eventType: "outOfOffice",
              start: { date: "2026-11-20" },
              end: { date: "2026-11-21" },
            },
          ],
        });
      }),
    );
    const events = await calendar().listOutOfOffice({
      timeMin: "2026-11-01T00:00:00+09:00",
      timeMax: "2026-12-01T00:00:00+09:00",
    });
    expect(events).toEqual([
      { start: { dateTime: "2026-11-09T13:00:00+09:00" }, end: { dateTime: "2026-11-09T18:00:00+09:00" } },
      { start: { date: "2026-11-20" }, end: { date: "2026-11-21" } },
    ]);
  });

  it("calendarId は URL エンコードする", async () => {
    let path = "";
    server.use(
      http.get(`${CAL}/calendars/:calendarId/events`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ items: [] });
      }),
    );
    await createCalendarClient({ getAccessToken, calendarId: "a b@example.com" }).listOutOfOffice({
      timeMin: "2026-11-01T00:00:00Z",
      timeMax: "2026-11-02T00:00:00Z",
    });
    expect(path).toBe("/calendar/v3/calendars/a%20b%40example.com/events");
  });
});

describe("Drive: 共有ドライブのフォルダとファイル", () => {
  const drive = () => createDriveClient({ getAccessToken, driveId: "shared-drive-1" });

  it("ensureFolder: 同じ名前のフォルダがあればそれを返す(共有ドライブ向けのパラメータを付ける)", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${DRIVE}/files`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ files: [{ id: "folder-1", name: "A 社" }] });
      }),
    );
    await expect(drive().ensureFolder({ parentId: "root-folder", name: "A 社" })).resolves.toEqual({
      id: "folder-1",
      name: "A 社",
    });
    expect(url?.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url?.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url?.searchParams.get("corpora")).toBe("drive");
    expect(url?.searchParams.get("driveId")).toBe("shared-drive-1");
    expect(url?.searchParams.get("q")).toBe(
      "name = 'A 社' and 'root-folder' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    );
  });

  it("ensureFolder: なければ作る", async () => {
    let body: unknown;
    let createUrl: URL | undefined;
    server.use(
      http.get(`${DRIVE}/files`, () => HttpResponse.json({ files: [] })),
      http.post(`${DRIVE}/files`, async ({ request }) => {
        createUrl = new URL(request.url);
        body = await request.json();
        return HttpResponse.json({ id: "new-folder", name: "A 社" });
      }),
    );
    await expect(drive().ensureFolder({ parentId: "root-folder", name: "A 社" })).resolves.toEqual({
      id: "new-folder",
      name: "A 社",
    });
    expect(createUrl?.searchParams.get("supportsAllDrives")).toBe("true");
    expect(body).toEqual({
      name: "A 社",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-folder"],
    });
  });

  it("ensureFolder: 名前のシングルクォートとバックスラッシュはエスケープする", async () => {
    let q: string | null = null;
    server.use(
      http.get(`${DRIVE}/files`, ({ request }) => {
        q = new URL(request.url).searchParams.get("q");
        return HttpResponse.json({ files: [{ id: "f", name: "x" }] });
      }),
    );
    await drive().ensureFolder({ parentId: "p", name: "O'Brien\\社" });
    expect(q).toContain("name = 'O\\'Brien\\\\社'");
  });

  it("uploadFile: multipart でアップロードする", async () => {
    let url: URL | undefined;
    let contentType: string | null = null;
    let text = "";
    server.use(
      http.post(`${UPLOAD}/files`, async ({ request }) => {
        url = new URL(request.url);
        contentType = request.headers.get("content-type");
        text = await request.text();
        return HttpResponse.json({ id: "file-1", name: "invoice.pdf", webViewLink: "https://drive.google.com/file/d/file-1/view" });
      }),
    );
    const file = await drive().uploadFile({
      folderId: "folder-1",
      name: "invoice.pdf",
      mimeType: "application/pdf",
      data: new TextEncoder().encode("%PDF-1.7 test"),
    });
    expect(file).toEqual({ id: "file-1", name: "invoice.pdf", webViewLink: "https://drive.google.com/file/d/file-1/view" });
    expect(url?.searchParams.get("uploadType")).toBe("multipart");
    expect(url?.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url?.searchParams.get("fields")).toBe("id,name,webViewLink");
    expect(contentType).toMatch(/^multipart\/related; boundary=/);
    expect(text).toContain('"parents":["folder-1"]');
    expect(text).toContain("Content-Type: application/pdf");
    expect(text).toContain("%PDF-1.7 test");
  });

  it("listFiles: フォルダの中のファイル(ゴミ箱は除く)", async () => {
    let q: string | null = null;
    server.use(
      http.get(`${DRIVE}/files`, ({ request }) => {
        q = new URL(request.url).searchParams.get("q");
        return HttpResponse.json({
          files: [{ id: "f1", name: "契約書.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/f1" }],
        });
      }),
    );
    await expect(drive().listFiles("folder-1")).resolves.toEqual([
      { id: "f1", name: "契約書.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/f1" },
    ]);
    expect(q).toBe("'folder-1' in parents and trashed = false");
  });
});

describe("エラー", () => {
  const drive = () => createDriveClient({ getAccessToken, driveId: "d" });

  it("401 / 403 は GoogleAuthError(共有の設定漏れや権限不足)", async () => {
    server.use(
      http.get(`${DRIVE}/files`, () =>
        HttpResponse.json({ error: { code: 403, message: "The caller does not have permission" } }, { status: 403 }),
      ),
    );
    const error = await drive()
      .listFiles("f")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error).toMatchObject({ status: 403, message: expect.stringContaining("does not have permission") });
  });

  it("そのほかは GoogleApiError", async () => {
    server.use(
      http.get(`${DRIVE}/files`, () => HttpResponse.json({ error: { code: 500, message: "Backend Error" } }, { status: 500 })),
    );
    await expect(drive().listFiles("f")).rejects.toBeInstanceOf(GoogleApiError);
  });

  it("エラーにアクセストークンを含めない", async () => {
    server.use(http.get(`${DRIVE}/files`, () => HttpResponse.json({ error: { message: "x" } }, { status: 500 })));
    const error = await drive()
      .listFiles("f")
      .catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain("access-token");
    expect(String((error as Error).message)).not.toContain("access-token");
  });

  it("トークンの取得に失敗したら GoogleAuthError", async () => {
    const failing = createDriveClient({
      getAccessToken: async () => {
        throw new Error("metadata server unreachable");
      },
      driveId: "d",
    });
    await expect(failing.listFiles("f")).rejects.toBeInstanceOf(GoogleAuthError);
  });
});
